package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/local/pdf-web-studio/apps/api/internal/config"
	"github.com/local/pdf-web-studio/apps/api/internal/database"
	"github.com/local/pdf-web-studio/apps/api/internal/httpapi"
	"github.com/local/pdf-web-studio/apps/api/internal/processing"
	"github.com/local/pdf-web-studio/apps/api/internal/storage"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(logger)
	cfg, err := config.Load()
	if err != nil {
		logger.Error("load configuration", "error", err)
		os.Exit(1)
	}
	store, err := storage.New(cfg.StorageRoot)
	if err != nil {
		logger.Error("initialize storage", "error", err)
		os.Exit(1)
	}
	pool, err := database.Open(context.Background(), cfg.DatabaseURL)
	if err != nil {
		logger.Error("initialize database pool", "error", err)
		os.Exit(1)
	}
	defer pool.Close()

	handler := httpapi.New(cfg, pool, store, &processing.Detector{})
	server := &http.Server{
		Addr:              cfg.APIAddr,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       cfg.ProcessingTimeout + time.Minute,
		WriteTimeout:      cfg.ProcessingTimeout + time.Minute,
		IdleTimeout:       60 * time.Second,
	}
	shutdownContext, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	go func() {
		<-shutdownContext.Done()
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := server.Shutdown(ctx); err != nil {
			logger.Error("graceful shutdown", "error", err)
		}
	}()
	logger.Info("API listening", "address", cfg.APIAddr, "storage_root", cfg.StorageRoot)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		logger.Error("serve API", "error", err)
		os.Exit(1)
	}
}
