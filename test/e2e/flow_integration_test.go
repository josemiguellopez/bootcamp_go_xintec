//go:build integration

// Package e2e prueba el flujo completo con PostgreSQL y RabbitMQ reales:
// crear pedido -> evento en RabbitMQ -> workers -> pedido CONFIRMED + notificación.
// También prueba que un mensaje que siempre falla termina en la DLQ.
package e2e

import (
	"context"
	"errors"
	"os"
	"sync"
	"testing"
	"time"

	notifUseCase "microservice/internal/notifications/application/usecase"
	notifInfra "microservice/internal/notifications/infrastructure"
	notifConsumer "microservice/internal/notifications/presentation/consumer"
	"microservice/internal/orders/application/dto"
	orderUseCase "microservice/internal/orders/application/usecase"
	orderInfra "microservice/internal/orders/infrastructure"
	orderConsumer "microservice/internal/orders/presentation/consumer"
	"microservice/pkg/database/dbtest"
	"microservice/pkg/events"
	"microservice/pkg/rabbitmq"
	"microservice/pkg/retry"

	"go.uber.org/zap"
)

var fastRetry = retry.Policy{MaxAttempts: 3, InitialBackoff: 10 * time.Millisecond, MaxBackoff: 50 * time.Millisecond}

func brokerURL(t *testing.T) string {
	url := os.Getenv("TEST_RABBITMQ_URL")
	if url == "" {
		t.Skip("TEST_RABBITMQ_URL not set; see docs/03-pruebas.md")
	}
	return url
}

// purgeQueues deja las colas vacías antes de cada prueba.
func purgeQueues(t *testing.T, url string) {
	conn, err := rabbitmq.Dial(url)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	ch, _ := conn.Channel()
	if err := rabbitmq.DeclareTopology(ch); err != nil {
		t.Fatal(err)
	}
	for _, q := range events.Queues {
		_, _ = ch.QueuePurge(q, false)
		_, _ = ch.QueuePurge(q+".dlq", false)
	}
}

func countMessages(t *testing.T, url, queue string) int {
	conn, err := rabbitmq.Dial(url)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	ch, _ := conn.Channel()
	q, err := ch.QueueDeclarePassive(queue, true, false, false, false, nil)
	if err != nil {
		t.Fatal(err)
	}
	return q.Messages
}

func waitUntil(t *testing.T, what string, cond func() bool) {
	for deadline := time.Now().Add(15 * time.Second); time.Now().Before(deadline); time.Sleep(100 * time.Millisecond) {
		if cond() {
			return
		}
	}
	t.Fatalf("timeout waiting for: %s", what)
}

func startConsumers(t *testing.T, consumers ...*rabbitmq.Consumer) {
	ctx, cancel := context.WithCancel(context.Background())
	var wg sync.WaitGroup
	for _, c := range consumers {
		wg.Add(1)
		go func(c *rabbitmq.Consumer) { defer wg.Done(); _ = c.Run(ctx) }(c)
	}
	t.Cleanup(func() { cancel(); wg.Wait() })
}

func TestOrderFlow_EndToEnd(t *testing.T) {
	url := brokerURL(t)
	purgeQueues(t, url)
	pool := dbtest.Pool(t)
	ctx := context.Background()

	publisher := rabbitmq.NewPublisher(url)
	defer publisher.Close()
	repo := orderInfra.NewPostgresOrderRepository(pool)

	confirm := orderConsumer.NewOrderCreatedHandler(orderUseCase.NewConfirmOrderUseCase(repo))
	notify := notifConsumer.NewOrderCreatedHandler(notifUseCase.NewSendOrderNotificationUseCase(
		notifInfra.NewPostgresNotificationRepository(pool), notifInfra.NewSimulatedEmailSender(0)))
	startConsumers(t,
		rabbitmq.NewConsumer(url, rabbitmq.ConsumerConfig{Name: "orders", Queue: events.QueueOrders, Retry: fastRetry}, confirm.Handle, zap.NewNop()),
		rabbitmq.NewConsumer(url, rabbitmq.ConsumerConfig{Name: "notifier", Queue: events.QueueNotifications, Retry: fastRetry}, notify.Handle, zap.NewNop()),
	)

	created, _, err := orderUseCase.NewCreateOrderUseCase(repo, orderInfra.NewRabbitMQEventPublisher(publisher)).
		Execute(ctx, dto.CreateOrderRequest{
			CustomerID: "customer-e2e",
			Items:      []dto.OrderItemRequest{{SKU: "SKU-1", Quantity: 1, UnitPriceCents: 500}},
		}, "")
	if err != nil {
		t.Fatal(err)
	}

	waitUntil(t, "order CONFIRMED and notification saved", func() bool {
		got, err := orderUseCase.NewGetOrderUseCase(repo).Execute(ctx, created.ID)
		var notified int
		_ = pool.QueryRow(ctx, `SELECT COUNT(*) FROM notifications WHERE order_id = $1`, created.ID).Scan(&notified)
		return err == nil && got.Status == "CONFIRMED" && notified == 1
	})
}

// RF-11: un consumidor que siempre falla reintenta 3 veces y el mensaje
// termina en su DLQ; la cola principal queda vacía.
func TestFailingMessageEndsInDLQ(t *testing.T) {
	url := brokerURL(t)
	purgeQueues(t, url)

	publisher := rabbitmq.NewPublisher(url)
	defer publisher.Close()

	var mu sync.Mutex
	attempts := 0
	startConsumers(t, rabbitmq.NewConsumer(url,
		rabbitmq.ConsumerConfig{Name: "always-fails", Queue: events.QueueNotifications, Retry: fastRetry},
		func(context.Context, rabbitmq.Delivery) error {
			mu.Lock()
			attempts++
			mu.Unlock()
			return errors.New("provider down")
		}, zap.NewNop()))

	if err := publisher.Publish(context.Background(), rabbitmq.Message{
		ID: "0d4b5c0e-4d3a-4a43-8f1e-2b8a6f7c9d10", Type: events.TypeOrderCreated, Body: []byte(`{}`),
	}); err != nil {
		t.Fatalf("publish: %v", err)
	}

	waitUntil(t, "message in notifications.send.dlq", func() bool {
		return countMessages(t, url, events.QueueNotifications+".dlq") == 1
	})
	mu.Lock()
	defer mu.Unlock()
	if attempts != 3 {
		t.Fatalf("attempts = %d, want 3", attempts)
	}
}
