// Command api runs the Vehicle Care HTTP server.
package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"

	"github.com/quoctann/vehicle-care/server/db/migrations"
	googleadapter "github.com/quoctann/vehicle-care/server/internal/adapters/google"
	"github.com/quoctann/vehicle-care/server/internal/adapters/httpapi"
	"github.com/quoctann/vehicle-care/server/internal/adapters/postgres"
	redisadapter "github.com/quoctann/vehicle-care/server/internal/adapters/redis"
	smtpadapter "github.com/quoctann/vehicle-care/server/internal/adapters/smtp"
	"github.com/quoctann/vehicle-care/server/internal/application/datasync"
	"github.com/quoctann/vehicle-care/server/internal/application/user"
	"github.com/quoctann/vehicle-care/server/internal/platform/config"
	"github.com/quoctann/vehicle-care/server/internal/platform/logging"
	"github.com/quoctann/vehicle-care/server/internal/platform/observability"
	"go.uber.org/zap"
)

type (
	postgresStore = postgres.Store
	sessionStore  = redisadapter.Store
)

type Datasource struct {
	*postgresStore
	*sessionStore
}

var _ user.IPorts = (*Datasource)(nil)
var _ datasync.IPorts = (*Datasource)(nil)
var _ httpapi.IOAuthStateStore = (*redisadapter.Store)(nil)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "API stopped due to a startup or server error")
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	logger, err := logging.NewWithFile(cfg.Environment, cfg.LogFile)
	if err != nil {
		return err
	}
	defer func() { _ = logger.Sync() }()
	shutdownTelemetry, err := observability.Init(context.Background(), cfg.Observability)
	if err != nil {
		return fmt.Errorf("initialize observability")
	}
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := shutdownTelemetry(ctx); err != nil {
			// Export errors may contain collector endpoint/credential details.
			logger.Warn("telemetry shutdown incomplete")
		}
	}()

	if cfg.AutoMigrate {
		if err := runAutoMigrate(cfg); err != nil {
			return fmt.Errorf("auto migrate")
		}
		logger.Info("auto migrate: schema up to date")
	}

	source, pingers, close, err := buildDatasource(context.Background(), cfg)
	if err != nil {
		return fmt.Errorf("initialize datasource")
	}
	defer close()

	var googleProvider user.IGoogleProvider
	if cfg.GoogleOAuthEnabled {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		googleProvider, err = googleadapter.New(ctx, cfg.GoogleClientID, cfg.GoogleClientSecret, cfg.GoogleRedirectURL)
		cancel()
		if err != nil {
			return fmt.Errorf("initialize Google OIDC")
		}
	}

	mailer := smtpadapter.New(smtpadapter.Options{
		Address:  net.JoinHostPort(cfg.SMTPHost, strconv.Itoa(cfg.SMTPPort)),
		Host:     cfg.SMTPHost,
		From:     cfg.SMTPFrom,
		Username: cfg.SMTPUsername,
		Password: cfg.SMTPPassword,
		StartTLS: cfg.SMTPStartTLS,
		Timeout:  cfg.SMTPTimeout,
	})

	userService := user.
		NewService(source, cfg.SessionTTL).
		WithMailDelivery(smtpadapter.Observe(mailer, logger), source, cfg.MailFrontendURL, cfg.SMTPTimeout)

	svc := &httpapi.Service{
		User:        userService,
		Google:      user.NewGoogleService(userService, source, googleProvider),
		AuthLimiter: source,
		APILimiter:  source,
		DataSync:    datasync.NewService(source, cfg.SyncMaxBatchSize, cfg.SyncMaxPageSize),
	}
	api := httpapi.New(svc, cfg, logger, pingers...)
	server := &http.Server{
		Addr:              cfg.Address(),
		Handler:           api.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	return serve(ctx, server, logger)
}

// serve returns errors rather than calling Fatal, allowing adapter/telemetry
// cleanup to run on listener failure as well as normal process cancellation.
func serve(ctx context.Context, server *http.Server, logger *zap.Logger) error {
	errorsCh := make(chan error, 1)
	go func() { errorsCh <- server.ListenAndServe() }()
	logger.Info("server listening", zap.String("address", server.Addr))
	select {
	case err := <-errorsCh:
		if !errors.Is(err, http.ErrServerClosed) {
			return fmt.Errorf("serve HTTP")
		}
		return nil
	case <-ctx.Done():
	}
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		_ = server.Close()
		return fmt.Errorf("graceful shutdown")
	}
	return nil
}

func runAutoMigrate(cfg config.Config) error {
	db, err := sql.Open("pgx", cfg.Database.DSN())
	if err != nil {
		return fmt.Errorf("open database: %w", err)
	}
	defer db.Close()

	if err := db.Ping(); err != nil {
		return fmt.Errorf("ping database: %w", err)
	}

	return migrations.Up(db)
}

func buildDatasource(ctx context.Context, cfg config.Config) (*Datasource, []httpapi.IPinger, func(), error) {
	pgStore, err := postgres.New(ctx, cfg.Database.DSN())
	if err != nil {
		return nil, nil, nil, err
	}

	redisClient, err := redisadapter.NewClient(redisadapter.Options{
		Addr:         cfg.RedisAddr,
		Password:     cfg.RedisPassword,
		DB:           cfg.RedisDB,
		TLSEnabled:   cfg.RedisTLSEnabled,
		DialTimeout:  cfg.RedisDialTimeout,
		ReadTimeout:  cfg.RedisReadTimeout,
		WriteTimeout: cfg.RedisWriteTimeout,
		PoolSize:     cfg.RedisPoolSize,
		MinIdleConns: cfg.RedisMinIdleConns,
		MaxRetries:   cfg.RedisMaxRetries,
	})
	if err != nil {
		_ = pgStore.Close()
		return nil, nil, nil, err
	}
	redisStore := redisadapter.NewStore(redisClient)

	datasource := &Datasource{
		postgresStore: pgStore,
		sessionStore:  redisStore,
	}
	closeFn := func() {
		_ = pgStore.Close()
		_ = redisClient.Close()
	}

	return datasource, []httpapi.IPinger{pgStore, redisStore}, closeFn, nil
}
