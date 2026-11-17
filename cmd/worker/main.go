// Comando worker: consume los eventos order.created con dos consumidores
// independientes, cada uno con su propia cola y su propia DLQ:
//   - worker de pedidos: pasa el pedido a listo_para_despacho
//   - worker de notificaciones: envía un email simulado
package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"microservice/cmd/config"
	healthHandler "microservice/internal/health/presentation/handler"
	healthRouter "microservice/internal/health/presentation/router"
	notifUseCase "microservice/internal/notifications/application/usecase"
	notifInfra "microservice/internal/notifications/infrastructure"
	notifConsumer "microservice/internal/notifications/presentation/consumer"
	orderUseCase "microservice/internal/orders/application/usecase"
	orderInfra "microservice/internal/orders/infrastructure"
	orderConsumer "microservice/internal/orders/presentation/consumer"
	"microservice/migrations"
	"microservice/pkg/database"
	"microservice/pkg/events"
	"microservice/pkg/logger"
	"microservice/pkg/rabbitmq"
	"microservice/pkg/retry"

	"golang.org/x/sync/errgroup"
)

func main() {
	// ctx se cancela al recibir SIGINT (Ctrl+C) o SIGTERM (docker stop).
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	if err := run(ctx); err != nil {
		fmt.Fprintln(os.Stderr, "worker stopped:", err)
		os.Exit(1) // docker compose (restart: unless-stopped) lo vuelve a levantar
	}
}

func run(ctx context.Context) error {
	if err := config.LoadEnvFile(); err != nil {
		return err
	}
	cfg, err := config.LoadVars()
	if err != nil {
		return err
	}
	log, err := logger.New("eventflow-worker", cfg.LogLevel)
	if err != nil {
		return err
	}
	logger.SetGlobal(log)
	defer log.Sync() //nolint:errcheck

	pool, err := database.NewPostgresPool(ctx, database.PostgresConfig{
		Host: cfg.DBHost, Port: cfg.DBPort, User: cfg.DBUser,
		Password: cfg.DBPassword, DBName: cfg.DBName, SSLMode: cfg.DBSSLMode,
	})
	if err != nil {
		return err
	}
	defer pool.Close()
	if err := database.Migrate(ctx, pool, migrations.FS, log); err != nil {
		return err
	}

	// Armado de dependencias (igual que el container de la API).
	markReady := orderConsumer.NewOrderCreatedHandler(
		orderUseCase.NewMarkReadyUseCase(orderInfra.NewPostgresOrderRepository(pool)))
	notify := notifConsumer.NewOrderCreatedHandler(notifUseCase.NewSendOrderNotificationUseCase(
		notifInfra.NewPostgresNotificationRepository(pool),
		notifInfra.NewSimulatedEmailSender(cfg.NotifierFailureRate)))

	consumerConfig := func(name, queue string) rabbitmq.ConsumerConfig {
		return rabbitmq.ConsumerConfig{
			Name:         name,
			Queue:        queue,
			Concurrency:  cfg.WorkerConcurrency,
			Retry:        retry.Policy{MaxAttempts: cfg.RetryMaxAttempts, InitialBackoff: cfg.RetryInitialBackoff, MaxBackoff: 5 * time.Second},
			DrainTimeout: cfg.ShutdownTimeout,
		}
	}
	consumers := []*rabbitmq.Consumer{
		rabbitmq.NewConsumer(cfg.RabbitMQURL, consumerConfig("order-processor", events.QueueOrders), markReady.Handle, log),
		rabbitmq.NewConsumer(cfg.RabbitMQURL, consumerConfig("notifier", events.QueueNotifications), notify.Handle, log),
	}

	// Servidor pequeño para /health, /ready y /metrics.
	ops := &http.Server{
		Addr:              ":" + strconv.Itoa(cfg.WorkerPort),
		Handler:           healthRouter.Routes(healthHandler.NewHealthHandler(pool.Ping)),
		ReadHeaderTimeout: 5 * time.Second,
	}
	go ops.ListenAndServe() //nolint:errcheck
	defer ops.Close()

	// errgroup corre cada consumidor en su propia goroutine. Si uno falla
	// (p. ej. se cae RabbitMQ), cancela ctx para que los demás se detengan, y
	// Wait devuelve ese primer error: el proceso sale y Docker lo reinicia.
	g, ctx := errgroup.WithContext(ctx)
	for _, c := range consumers {
		g.Go(func() error { return c.Run(ctx) })
	}
	log.Info("worker started")
	err = g.Wait()
	log.Info("worker stopped")
	return err
}
