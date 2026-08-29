package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"garuda/backend/internal/api"
	"garuda/backend/internal/config"
	"garuda/backend/internal/meta"
	"garuda/backend/internal/store"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		slog.Error("configuration is invalid", "error", err)
		os.Exit(1)
	}
	level := slog.LevelInfo
	switch strings.ToLower(cfg.LogLevel) {
	case "debug":
		level = slog.LevelDebug
	case "warn":
		level = slog.LevelWarn
	case "error":
		level = slog.LevelError
	}
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: level}))
	slog.SetDefault(logger)

	dataStore, err := store.OpenFile(cfg.DataFile)
	if err != nil {
		logger.Error("storage could not be opened", "error", err)
		os.Exit(1)
	}
	defer dataStore.Close()

	// Meta conversion reporting. It polls committed state on its own goroutine,
	// so a slow or dead Conversions API can never reach a visitor's conversation
	// or delay a customer's webhook. With no META_* credentials it reads nothing
	// and writes nothing, exactly like every other adapter here.
	//
	// The price is passed in rather than defaulted inside the reporter: a second
	// copy of it could silently drift from what Stripe actually charges, and a
	// wrong number in an ad platform's optimiser is worse than no number.
	metaReporter := meta.NewReporter(meta.ReporterOptions{
		Client:            meta.New(cfg.MetaAPIURL, cfg.MetaPixelID, cfg.MetaConversionsToken, cfg.MetaTestEventCode),
		Store:             dataStore,
		Path:              meta.StatePath(cfg.DataFile),
		Logger:            logger,
		PlanValueCents:    cfg.PlanAmountCents,
		PlanCurrency:      cfg.PlanCurrency,
		SignUpSourceURL:   cfg.AuthVerifyURL,
		CheckoutSourceURL: cfg.PublicURL,
	})
	defer metaReporter.Close()

	service := api.New(cfg, dataStore, logger)
	server := &http.Server{
		Addr:              cfg.Address,
		Handler:           service.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      70 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}

	shutdownContext, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		logger.Info("Garuda API listening", "address", cfg.Address, "demo_mode", cfg.DemoMode)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("HTTP server stopped unexpectedly", "error", err)
			os.Exit(1)
		}
	}()

	<-shutdownContext.Done()
	logger.Info("shutting down")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(ctx); err != nil {
		logger.Error("graceful shutdown failed", "error", err)
	}
}
