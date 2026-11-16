// Package consumer conecta los mensajes de RabbitMQ con el caso de uso de
// notificaciones.
package consumer

import (
	"context"

	"microservice/internal/notifications/application/usecase"
	"microservice/internal/notifications/domain"
	"microservice/pkg/events"
	"microservice/pkg/logger"
	"microservice/pkg/metrics"
	"microservice/pkg/rabbitmq"
	"microservice/pkg/retry"
)

type OrderCreatedHandler struct {
	send *usecase.SendOrderNotificationUseCase
}

func NewOrderCreatedHandler(send *usecase.SendOrderNotificationUseCase) *OrderCreatedHandler {
	return &OrderCreatedHandler{send: send}
}

// Handle cumple la firma rabbitmq.Handler.
func (h *OrderCreatedHandler) Handle(ctx context.Context, d rabbitmq.Delivery) error {
	event, err := events.DecodeOrderCreated(d.Body)
	if err != nil {
		return retry.Permanent(err)
	}

	sent, err := h.send.Execute(ctx, domain.Message{
		EventID:    event.EventID,
		OrderID:    event.OrderID,
		CustomerID: event.CustomerID,
		TotalCents: event.TotalCents,
	})
	if err != nil {
		return err // proveedor o base de datos no disponibles: se reintenta
	}
	if !sent {
		metrics.Inc(metrics.MessagesDuplicated)
		logger.FromContext(ctx).Info("duplicate message ignored: notification already sent")
	}
	return nil
}
