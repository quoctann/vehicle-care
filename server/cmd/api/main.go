// Command api runs the Vehicle Care HTTP server.
package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"

	"github.com/quoctann/vehicle-care/server/db/migrations"
	"github.com/quoctann/vehicle-care/server/internal/adapters/httpapi"
	"github.com/quoctann/vehicle-care/server/internal/adapters/postgres"
	redisadapter "github.com/quoctann/vehicle-care/server/internal/adapters/redis"
	"github.com/quoctann/vehicle-care/server/internal/application/datasync"
	"github.com/quoctann/vehicle-care/server/internal/application/user"
	"github.com/quoctann/vehicle-care/server/internal/platform/config"
	"github.com/quoctann/vehicle-care/server/internal/platform/logging"
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

var _ user.IDependencies = (*Datasource)(nil)
var _ datasync.IDependencies = (*Datasource)(nil)
var _ httpapi.IOAuthStateStore = (*redisadapter.Store)(nil)

func main() {
	cfg, err := config.Load()
	if err != nil {
		panic(err)
	}

	logger, err := logging.New(cfg.Environment)
	if err != nil {
		panic(err)
	}
	defer func() { _ = logger.Sync() }()

	if cfg.AutoMigrate {
		if err := runAutoMigrate(cfg); err != nil {
			logger.Fatal("auto migrate", zap.Error(err))
		}
		logger.Info("auto migrate: schema up to date")
	}

	source, pingers, close, err := buildDatasource(context.Background(), cfg)
	if err != nil {
		logger.Fatal("init datasource", zap.Error(err))
	}
	defer close()

	svc := &httpapi.Service{
		User:     user.NewService(source, cfg.SessionTTL),
		DataSync: datasync.NewService(source, cfg.SyncMaxBatchSize, cfg.SyncMaxPageSize),
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

	go func() {
		logger.Info("server listening", zap.String("address", cfg.Address()), zap.String("frontend_origin", cfg.FrontendOrigin))
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Fatal("serve HTTP", zap.Error(err))
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		logger.Error("graceful shutdown", zap.Error(err))
	}
}

// runAutoMigrate opens a short-lived, separate *sql.DB (independent of the
// long-lived pool buildDatasource creates) and applies pending migrations
// through it, closing it before the API's own connections are opened.
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
