package infrastructure

import (
	"context"
	"encoding/json"
	"fmt"

	"microservice/internal/orders/domain"
	"microservice/pkg/events"
	"microservice/pkg/rabbitmq"
)

// RabbitMQEventPublisher implementa domain.EventPublisher: convierte el
// evento del dominio al formato JSON acordado (pkg/events) y lo publica.
type RabbitMQEventPublisher struct {
	publisher *rabbitmq.Publisher
}

func NewRabbitMQEventPublisher(p *rabbitmq.Publisher) *RabbitMQEventPublisher {
	return &RabbitMQEventPublisher{publisher: p}
}

func (p *RabbitMQEventPublisher) PublishOrderCreated(ctx context.Context, e domain.OrderCreated) error {
	body, err := json.Marshal(events.OrderCreated{
		EventID:       e.EventID,
		EventType:     events.TypeOrderCreated,
		OccurredAt:    e.OccurredAt,
		CorrelationID: e.CorrelationID,
		OrderID:       e.OrderID,
		CustomerID:    e.CustomerID,
		TotalCents:    e.TotalCents,
	})
	if err != nil {
		return fmt.Errorf("encode event: %w", err)
	}
	return p.publisher.Publish(ctx, rabbitmq.Message{
		ID:            e.EventID,
		Type:          events.TypeOrderCreated,
		CorrelationID: e.CorrelationID,
		Body:          body,
	})
}
