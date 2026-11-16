// Package events define el formato de los mensajes que viajan por RabbitMQ
// (RF-09) y los nombres de exchanges y colas. La API (que publica) y el
// worker (que consume) comparten este contrato.
package events

import (
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
)

const (
	TypeOrderCreated = "order.created"

	Exchange           = "eventflow.events" // exchange principal (tipo topic)
	DeadLetterExchange = "eventflow.dlx"    // recibe los mensajes rechazados

	QueueOrders        = "orders.processing"  // la consume el worker de pedidos
	QueueNotifications = "notifications.send" // la consume el worker de notificaciones
)

// Queues son las colas que reciben order.created. Cada una tiene su cola de
// mensajes muertos con el sufijo ".dlq".
var Queues = []string{QueueOrders, QueueNotifications}

// OrderCreated es el evento que se publica al crear un pedido:
// tiene ID, tipo, fecha y referencia al pedido, como pide RF-09.
type OrderCreated struct {
	EventID       string    `json:"event_id"`
	EventType     string    `json:"event_type"`
	OccurredAt    time.Time `json:"occurred_at"`
	CorrelationID string    `json:"correlation_id,omitempty"`
	OrderID       string    `json:"order_id"`
	CustomerID    string    `json:"customer_id"`
	TotalCents    int64     `json:"total_cents"`
}

// DecodeOrderCreated lee y valida un mensaje. Si falla, el mensaje está mal
// formado y reintentarlo no lo va a arreglar.
func DecodeOrderCreated(body []byte) (OrderCreated, error) {
	var e OrderCreated
	if err := json.Unmarshal(body, &e); err != nil {
		return e, fmt.Errorf("invalid JSON: %w", err)
	}
	if e.EventType != TypeOrderCreated {
		return e, fmt.Errorf("unexpected event type %q", e.EventType)
	}
	if _, err := uuid.Parse(e.EventID); err != nil {
		return e, errors.New("invalid event_id")
	}
	if _, err := uuid.Parse(e.OrderID); err != nil {
		return e, errors.New("invalid order_id")
	}
	return e, nil
}
