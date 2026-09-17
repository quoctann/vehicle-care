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
	"github.com/quoctann/vehicle-care/server/internal/application"
	"github.com/quoctann/vehicle-care/server/internal/platform/config"
	"github.com/quoctann/vehicle-care/server/internal/platform/logging"
	"go.uber.org/zap"
)

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

	store := memory.NewStore()
	service := application.NewService(store, cfg.SessionTTL, cfg.SyncMaxBatchSize, cfg.SyncMaxPageSize)
	if cfg.MockAuthEnabled {
		if err := service.SeedDemoAccount(context.Background()); err != nil {
			logger.Fatal("seed demo account", zap.Error(err))
		}
	}
	api := httpapi.New(service, cfg, logger)
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
