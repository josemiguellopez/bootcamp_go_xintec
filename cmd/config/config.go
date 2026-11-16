// Package config lee la configuración desde variables de entorno (RF-06).
// Los valores por defecto sirven para desarrollo local con docker compose.
package config

import (
	"fmt"
	"time"

	"github.com/caarlos0/env/v6"
	"github.com/go-playground/validator/v10"
)

type Configuration struct {
	AppEnv          string        `env:"ENVIRONMENT" envDefault:"dev" validate:"oneof=dev qa prod"`
	LogLevel        string        `env:"LOG_LEVEL" envDefault:"info" validate:"oneof=debug info warn error"`
	ShutdownTimeout time.Duration `env:"SHUTDOWN_TIMEOUT" envDefault:"20s" validate:"gt=0"`

	// API
	Port           int           `env:"PORT" envDefault:"3200"`
	RequestTimeout time.Duration `env:"REQUEST_TIMEOUT" envDefault:"5s" validate:"gt=0"`
	MaxBodyBytes   int64         `env:"MAX_BODY_BYTES" envDefault:"65536" validate:"min=1024"`

	// PostgreSQL
	DBHost     string `env:"DB_HOST" envDefault:"localhost"`
	DBPort     int    `env:"DB_PORT" envDefault:"5432"`
	DBUser     string `env:"DB_USER" envDefault:"postgres"`
	DBPassword string `env:"DB_PASSWORD" envDefault:"postgres"`
	DBName     string `env:"DB_NAME" envDefault:"eventflow"`
	DBSSLMode  string `env:"DB_SSL_MODE" envDefault:"disable"`

	// RabbitMQ
	RabbitMQURL string `env:"RABBITMQ_URL" envDefault:"amqp://guest:guest@localhost:5672/"`

	// Worker
	WorkerPort          int           `env:"WORKER_PORT" envDefault:"3201"`
	WorkerConcurrency   int           `env:"WORKER_CONCURRENCY" envDefault:"4" validate:"min=1,max=64"`
	RetryMaxAttempts    int           `env:"RETRY_MAX_ATTEMPTS" envDefault:"4" validate:"min=1,max=20"`
	RetryInitialBackoff time.Duration `env:"RETRY_INITIAL_BACKOFF" envDefault:"500ms" validate:"gt=0"`
	NotifierFailureRate float64       `env:"NOTIFIER_FAILURE_RATE" envDefault:"0" validate:"min=0,max=1"`
}

func LoadVars() (*Configuration, error) {
	cfg := &Configuration{}
	if err := env.Parse(cfg); err != nil {
		return nil, fmt.Errorf("read environment: %w", err)
	}
	if err := validator.New().Struct(cfg); err != nil {
		return nil, fmt.Errorf("invalid configuration: %w", err)
	}
	return cfg, nil
}
