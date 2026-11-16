// Package usecase contiene los casos de uso de pedidos. Coordinan el dominio
// y los puertos (repositorio, publicador) sin saber nada de HTTP ni de SQL.
package usecase

import (
	"context"
	"fmt"
	"time"

	"microservice/internal/orders/application/dto"
	"microservice/internal/orders/domain"
	"microservice/pkg/apperrors"
	"microservice/pkg/correlation"
	"microservice/pkg/logger"
	"microservice/pkg/metrics"

	"github.com/google/uuid"
	"go.uber.org/zap"
)

const MaxIdempotencyKeyLen = 128

type CreateOrderUseCase struct {
	repo   domain.OrderRepository
	events domain.EventPublisher
}

func NewCreateOrderUseCase(repo domain.OrderRepository, events domain.EventPublisher) *CreateOrderUseCase {
	return &CreateOrderUseCase{repo: repo, events: events}
}

// Execute valida y guarda el pedido y luego publica el evento order.created.
// Devuelve created=false cuando la Idempotency-Key ya se había usado: en ese
// caso no se crea nada y se devuelve el pedido original (RF-10).
func (uc *CreateOrderUseCase) Execute(ctx context.Context, req dto.CreateOrderRequest, idempotencyKey string) (dto.OrderResponse, bool, error) {
	if len(idempotencyKey) > MaxIdempotencyKeyLen {
		return dto.OrderResponse{}, false, apperrors.NewValidationError("IDEMPOTENCY_KEY_INVALID",
			fmt.Sprintf("Idempotency-Key must be at most %d characters", MaxIdempotencyKeyLen))
	}

	items := make([]domain.Item, len(req.Items))
	for i, it := range req.Items {
		items[i] = domain.Item{SKU: it.SKU, Quantity: it.Quantity, UnitPriceCents: it.UnitPriceCents}
	}

	// 1. El dominio valida las reglas de negocio.
	order, err := domain.NewOrder(uuid.NewString(), req.CustomerID, items, time.Now())
	if err != nil {
		return dto.OrderResponse{}, false, err
	}

	// 2. Guardar (o recuperar el pedido existente si la clave ya se usó).
	saved, created, err := uc.repo.Create(ctx, order, idempotencyKey)
	if err != nil {
		return dto.OrderResponse{}, false, fmt.Errorf("save order: %w", err)
	}

	log := logger.FromContext(ctx).With(zap.String("order_id", saved.ID()))
	if !created {
		metrics.Inc(metrics.OrdersReplayed)
		log.Info("idempotency key already used, returning existing order")
		return dto.FromOrder(saved), false, nil
	}
	metrics.Inc(metrics.OrdersCreated)
	log.Info("order created")

	// 3. Publicar el evento. El pedido YA está guardado: si el broker falla,
	// no devolvemos error (el cliente reintentaría y recibiría el mismo
	// pedido). El evento se pierde y el pedido queda PENDING: es la brecha
	// conocida que resolvería el patrón outbox (ver README).
	err = uc.events.PublishOrderCreated(ctx, domain.OrderCreated{
		EventID:       uuid.NewString(),
		OccurredAt:    saved.CreatedAt(),
		CorrelationID: correlation.ID(ctx),
		OrderID:       saved.ID(),
		CustomerID:    saved.CustomerID(),
		TotalCents:    saved.TotalCents(),
	})
	if err != nil {
		metrics.Inc(metrics.EventsPublishFailed)
		log.Error("order saved but event could not be published", zap.Error(err))
	} else {
		metrics.Inc(metrics.EventsPublished)
	}

	return dto.FromOrder(saved), true, nil
}
