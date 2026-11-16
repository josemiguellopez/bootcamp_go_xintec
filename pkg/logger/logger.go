// Package logger configura zap con salida JSON (logs estructurados, RF-13) y
// permite guardar en el context.Context un logger con campos de correlación
// (request_id, event_id...), para que cada línea se pueda relacionar.
package logger

import (
	"context"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

var global = zap.NewNop()

// New crea un logger JSON. level: debug, info, warn o error.
func New(service, level string) (*zap.Logger, error) {
	lvl, err := zapcore.ParseLevel(level)
	if err != nil {
		return nil, err
	}
	cfg := zap.NewProductionConfig()
	cfg.Level = zap.NewAtomicLevelAt(lvl)
	cfg.EncoderConfig.TimeKey = "ts"
	cfg.EncoderConfig.EncodeTime = zapcore.ISO8601TimeEncoder
	cfg.EncoderConfig.EncodeDuration = zapcore.StringDurationEncoder
	return cfg.Build(zap.Fields(zap.String("service", service)))
}

// SetGlobal define el logger que se usa cuando el contexto no trae uno.
// Se llama una sola vez al arrancar.
func SetGlobal(l *zap.Logger) { global = l }

type ctxKey struct{}

// WithContext guarda l en ctx.
func WithContext(ctx context.Context, l *zap.Logger) context.Context {
	return context.WithValue(ctx, ctxKey{}, l)
}

// FromContext devuelve el logger guardado en ctx o el global.
func FromContext(ctx context.Context) *zap.Logger {
	if l, ok := ctx.Value(ctxKey{}).(*zap.Logger); ok {
		return l
	}
	return global
}
