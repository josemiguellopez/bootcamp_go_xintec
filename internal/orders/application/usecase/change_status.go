package usecase

import (
	"context"
	"time"

	"microservice/internal/orders/application/dto"
	"microservice/internal/orders/domain"
	"microservice/pkg/apperrors"

	"github.com/google/uuid"
)

// ChangeStatusUseCase mueve un pedido a otro estado (PATCH /orders/{id}/status),
// por ejemplo de listo_para_despacho a en_transito. Las reglas de qué cambios
// están permitidos viven en el dominio (domain/status.go).
type ChangeStatusUseCase struct {
	repo domain.OrderRepository
}

func NewChangeStatusUseCase(repo domain.OrderRepository) *ChangeStatusUseCase {
	return &ChangeStatusUseCase{repo: repo}
}

// Execute devuelve el pedido ya actualizado.
//
//	400 ORDER_INVALID_ID / ORDER_INVALID_STATUS -> datos mal escritos
//	404 ORDER_NOT_FOUND                          -> el pedido no existe
//	409 ORDER_INVALID_TRANSITION                 -> el cambio no está permitido
func (uc *ChangeStatusUseCase) Execute(ctx context.Context, id string, req dto.ChangeStatusRequest) (dto.OrderResponse, error) {
	if _, err := uuid.Parse(id); err != nil {
		return dto.OrderResponse{}, apperrors.NewValidationError("ORDER_INVALID_ID", "order id must be a valid UUID")
	}
	to, err := domain.ParseStatus(req.Status)
	if err != nil {
		return dto.OrderResponse{}, err
	}

	if err := uc.repo.UpdateStatus(ctx, id, func(o *domain.Order) error {
		return o.TransitionTo(to, time.Now())
	}); err != nil {
		return dto.OrderResponse{}, err
	}

	order, err := uc.repo.FindByID(ctx, id)
	if err != nil {
		return dto.OrderResponse{}, err
	}
	return dto.FromOrder(order), nil
}
