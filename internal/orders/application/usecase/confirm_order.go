package usecase

import (
	"context"
	"errors"
	"time"

	"microservice/internal/orders/domain"
)

// ConfirmOrderUseCase lo ejecuta el worker de pedidos al recibir order.created.
// Es idempotente: si el mismo evento llega dos veces, la segunda no cambia nada.
type ConfirmOrderUseCase struct {
	repo domain.OrderRepository
}

func NewConfirmOrderUseCase(repo domain.OrderRepository) *ConfirmOrderUseCase {
	return &ConfirmOrderUseCase{repo: repo}
}

var errAlreadyConfirmed = errors.New("order already confirmed")

// Execute devuelve alreadyConfirmed=true si el pedido ya estaba confirmado
// (es decir, el mensaje era un duplicado).
func (uc *ConfirmOrderUseCase) Execute(ctx context.Context, orderID string) (alreadyConfirmed bool, err error) {
	err = uc.repo.UpdateStatus(ctx, orderID, func(o *domain.Order) error {
		if o.Status() == domain.StatusConfirmed {
			return errAlreadyConfirmed // no hay nada que guardar
		}
		return o.Confirm(time.Now())
	})
	if errors.Is(err, errAlreadyConfirmed) {
		return true, nil
	}
	return false, err
}
