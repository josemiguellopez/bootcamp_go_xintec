// Package usecase contiene el caso de uso de notificar al cliente.
package usecase

import (
	"context"
	"fmt"

	"microservice/internal/notifications/domain"
)

type SendOrderNotificationUseCase struct {
	repo   domain.Repository
	sender domain.Sender
}

func NewSendOrderNotificationUseCase(repo domain.Repository, sender domain.Sender) *SendOrderNotificationUseCase {
	return &SendOrderNotificationUseCase{repo: repo, sender: sender}
}

// Execute envía la notificación una sola vez por evento. Devuelve
// sent=false si ese evento ya se había notificado (mensaje duplicado).
//
// Limitación conocida: si el worker se cae justo después de enviar y antes de
// MarkSent, al reintentar se enviaría otra vez. Por eso se pasa EventID al
// proveedor: uno real lo usaría para descartar el duplicado.
func (uc *SendOrderNotificationUseCase) Execute(ctx context.Context, m domain.Message) (sent bool, err error) {
	done, err := uc.repo.AlreadySent(ctx, m.EventID)
	if err != nil {
		return false, fmt.Errorf("check notification: %w", err)
	}
	if done {
		return false, nil
	}
	if err := uc.sender.Send(ctx, m); err != nil {
		return false, fmt.Errorf("send notification: %w", err)
	}
	if err := uc.repo.MarkSent(ctx, m.EventID, m.OrderID); err != nil {
		return false, fmt.Errorf("save notification: %w", err)
	}
	return true, nil
}
