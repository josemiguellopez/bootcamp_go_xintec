package usecase

import (
	"context"
	"errors"
	"time"

	"microservice/internal/orders/domain"
)

// MarkReadyUseCase lo ejecuta el worker de pedidos al recibir order.created:
// pasa el pedido de en_preparacion a listo_para_despacho.
// Es idempotente: si el mismo evento llega dos veces, la segunda no cambia nada.
type MarkReadyUseCase struct {
	repo domain.OrderRepository
}

func NewMarkReadyUseCase(repo domain.OrderRepository) *MarkReadyUseCase {
	return &MarkReadyUseCase{repo: repo}
}

var errAlreadyProcessed = errors.New("order already processed")

// Execute devuelve alreadyProcessed=true si el pedido ya no estaba en
// preparación (el mensaje era un duplicado, o alguien ya lo movió a mano).
func (uc *MarkReadyUseCase) Execute(ctx context.Context, orderID string) (alreadyProcessed bool, err error) {
	err = uc.repo.UpdateStatus(ctx, orderID, func(o *domain.Order) error {
		if o.Status() != domain.StatusEnPreparacion {
			return errAlreadyProcessed // no hay nada que guardar
		}
		return o.TransitionTo(domain.StatusListoParaDespacho, time.Now())
	})
	if errors.Is(err, errAlreadyProcessed) {
		return true, nil
	}
	return false, err
}
