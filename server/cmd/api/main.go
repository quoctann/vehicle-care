// Command api runs the Vehicle Care HTTP server.
package main

import (
	"context"
	"errors"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/quoctann/vehicle-care/server/internal/adapters/httpapi"
	"github.com/quoctann/vehicle-care/server/internal/adapters/memory"
	"github.com/quoctann/vehicle-care/server/internal/adapters/postgres"
	redisadapter "github.com/quoctann/vehicle-care/server/internal/adapters/redis"
	"github.com/quoctann/vehicle-care/server/internal/application"
	"github.com/quoctann/vehicle-care/server/internal/platform/config"
	"github.com/quoctann/vehicle-care/server/internal/platform/logging"
	"github.com/quoctann/vehicle-care/server/internal/ports"
	"go.uber.org/zap"
)

// liveStore composes the PostgreSQL adapter (accounts, devices, sync
// changefeed) and the Redis adapter (sessions, tokens) into the single
// ports.Store the application layer depends on. Struct embedding promotes
// each adapter's methods directly; the two adapters share no method names.
// Both concrete types happen to be named "Store" in their own packages, so
// each is embedded through a local alias to give it a distinct field name.
type (
	postgresStore = postgres.Store
	sessionStore  = redisadapter.Store
)

type liveStore struct {
	*postgresStore
	*sessionStore
}

var _ ports.Store = (*liveStore)(nil)

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

	store, pingers, closeStore, err := buildStore(context.Background(), cfg)
	if err != nil {
		logger.Fatal("build store", zap.Error(err))
	}
	defer closeStore()

	service := application.NewService(store, cfg.SessionTTL, cfg.SyncMaxBatchSize, cfg.SyncMaxPageSize)
	if cfg.MockAuthEnabled {
		if err := service.SeedDemoAccount(context.Background()); err != nil {
			logger.Fatal("seed demo account", zap.Error(err))
		}
	}
	api := httpapi.New(service, cfg, logger, pingers...)
	server := &http.Server{
		Addr: cfg.Address(), Handler: api.Handler(), ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout: 15 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 1 << 20,
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

// buildStore constructs the persistence backend selected by cfg.StoreDriver.
// It returns the store, the set of dependencies /health/ready should ping,
// and a cleanup func that releases any connections opened here.
func buildStore(ctx context.Context, cfg config.Config) (ports.Store, []httpapi.Pinger, func(), error) {
	if cfg.StoreDriver == "memory" {
		store := memory.NewStore()
		return store, nil, func() {}, nil
	}

	pgStore, err := postgres.New(ctx, cfg.DatabaseURL)
	if err != nil {
		return nil, nil, nil, err
	}

	redisClient, err := redisadapter.NewClient(redisadapter.Options{
		Addr: cfg.RedisAddr, Password: cfg.RedisPassword, DB: cfg.RedisDB, TLSEnabled: cfg.RedisTLSEnabled,
		DialTimeout: cfg.RedisDialTimeout, ReadTimeout: cfg.RedisReadTimeout, WriteTimeout: cfg.RedisWriteTimeout,
		PoolSize: cfg.RedisPoolSize, MinIdleConns: cfg.RedisMinIdleConns, MaxRetries: cfg.RedisMaxRetries,
	})
	if err != nil {
		_ = pgStore.Close()
		return nil, nil, nil, err
	}
	redisStore := redisadapter.NewStore(redisClient)

	store := &liveStore{postgresStore: pgStore, sessionStore: redisStore}
	closeStore := func() {
		_ = pgStore.Close()
		_ = redisClient.Close()
	}
	return store, []httpapi.Pinger{pgStore, redisStore}, closeStore, nil
}
