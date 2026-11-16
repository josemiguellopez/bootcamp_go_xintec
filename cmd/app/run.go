package app

import (
	"context"
	"errors"
	"net/http"

	"go.uber.org/zap"
)

// Run atiende peticiones hasta que ctx se cancele (SIGINT/SIGTERM).
//
// Apagado ordenado (RF-14):
//  1. Shutdown deja de aceptar conexiones nuevas y espera a que terminen las
//     peticiones en curso, como máximo SHUTDOWN_TIMEOUT.
//  2. Se cierran RabbitMQ y PostgreSQL.
func (a *App) Run(ctx context.Context) error {
	serverErr := make(chan error, 1)
	go func() {
		a.log.Info("api listening", zap.String("addr", a.server.Addr))
		if err := a.server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serverErr <- err
		}
	}()

	select {
	case err := <-serverErr:
		return err // no pudo arrancar (p. ej. puerto ocupado)
	case <-ctx.Done():
		a.log.Info("shutdown signal received")
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), a.config.ShutdownTimeout)
	defer cancel()
	if err := a.server.Shutdown(shutdownCtx); err != nil {
		a.log.Error("some requests did not finish in time", zap.Error(err))
	}

	a.publisher.Close()
	a.pool.Close()
	a.log.Info("shutdown complete")
	_ = a.log.Sync()
	return nil
}
