package domain

import (
	"context"
	"time"

	"microservice/pkg/apperrors"
)

// OrderRepository es el "puerto" de persistencia: el dominio dice QUÉ necesita
// y la capa de infraestructura (PostgreSQL) dice CÓMO se hace.
type OrderRepository interface {
	// Create guarda el pedido. Si idempotencyKey no está vacía y ya se usó,
	// no guarda nada y devuelve el pedido que se creó con esa clave
	// (created=false).
	Create(ctx context.Context, o *Order, idempotencyKey string) (saved *Order, created bool, err error)

	// FindByID devuelve ErrOrderNotFound si el pedido no existe.
	FindByID(ctx context.Context, id string) (*Order, error)

	// UpdateStatus lee el pedido bloqueándolo, le aplica change y guarda el
	// nuevo estado. Si change devuelve error, no se guarda nada.
	UpdateStatus(ctx context.Context, id string, change func(*Order) error) error
}

// OrderCreated es el evento "se creó un pedido".
type OrderCreated struct {
	EventID       string
	OccurredAt    time.Time
	CorrelationID string
	OrderID       string
	CustomerID    string
	Total         int64
}

// EventPublisher es el puerto para publicar eventos (lo implementa RabbitMQ).
type EventPublisher interface {
	PublishOrderCreated(ctx context.Context, e OrderCreated) error
}

const CodeOrderNotFound = "ORDER_NOT_FOUND"

// ErrOrderNotFound crea el error de pedido inexistente (HTTP 404).
func ErrOrderNotFound() error {
	return apperrors.NewNotFoundError(CodeOrderNotFound, "order not found")
}
