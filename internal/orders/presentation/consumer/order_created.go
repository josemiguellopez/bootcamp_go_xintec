// Package consumer traduce mensajes de RabbitMQ <-> casos de uso (es el
// equivalente al handler HTTP, pero para eventos).
package consumer

import (
	"context"

	"microservice/internal/orders/application/usecase"
	"microservice/pkg/apperrors"
	"microservice/pkg/events"
	"microservice/pkg/logger"
	"microservice/pkg/metrics"
	"microservice/pkg/rabbitmq"
	"microservice/pkg/retry"

	"go.uber.org/zap"
)

// OrderCreatedHandler deja el pedido listo para despacho cuando llega order.created.
type OrderCreatedHandler struct {
	markReady *usecase.MarkReadyUseCase
}

func NewOrderCreatedHandler(markReady *usecase.MarkReadyUseCase) *OrderCreatedHandler {
	return &OrderCreatedHandler{markReady: markReady}
}

// Handle cumple la firma rabbitmq.Handler.
func (h *OrderCreatedHandler) Handle(ctx context.Context, d rabbitmq.Delivery) error {
	event, err := events.DecodeOrderCreated(d.Body)
	if err != nil {
		return retry.Permanent(err) // mensaje mal formado: reintentar no sirve
	}

	alreadyProcessed, err := h.markReady.Execute(ctx, event.OrderID)
	if err != nil {
		if _, isBusinessError := apperrors.As(err); isBusinessError {
			return retry.Permanent(err) // p. ej. el pedido no existe
		}
		return err // p. ej. la base de datos no responde: se reintenta
	}

	log := logger.FromContext(ctx).With(zap.String("order_id", event.OrderID))
	if alreadyProcessed {
		metrics.Inc(metrics.MessagesDuplicated)
		log.Info("duplicate message ignored: order already processed")
		return nil
	}
	log.Info("order ready for dispatch")
	return nil
}
