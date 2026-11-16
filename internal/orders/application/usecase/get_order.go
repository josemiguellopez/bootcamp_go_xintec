package usecase

import (
	"context"

	"microservice/internal/orders/application/dto"
	"microservice/internal/orders/domain"
	"microservice/pkg/apperrors"

	"github.com/google/uuid"
)

type GetOrderUseCase struct {
	repo domain.OrderRepository
}

func NewGetOrderUseCase(repo domain.OrderRepository) *GetOrderUseCase {
	return &GetOrderUseCase{repo: repo}
}

func (uc *GetOrderUseCase) Execute(ctx context.Context, id string) (dto.OrderResponse, error) {
	if _, err := uuid.Parse(id); err != nil {
		return dto.OrderResponse{}, apperrors.NewValidationError("ORDER_INVALID_ID", "order id must be a valid UUID")
	}
	order, err := uc.repo.FindByID(ctx, id)
	if err != nil {
		return dto.OrderResponse{}, err
	}
	return dto.FromOrder(order), nil
}
