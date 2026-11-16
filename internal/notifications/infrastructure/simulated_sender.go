package infrastructure

import (
	"context"
	"errors"
	"math/rand/v2"
	"time"

	"microservice/internal/notifications/domain"
	"microservice/pkg/logger"

	"go.uber.org/zap"
)

// SimulatedEmailSender reemplaza a un proveedor de email real (fuera del
// alcance del desafío). failureRate permite simular fallos para ver los
// reintentos: 0.3 = 30 % de los intentos fallan; 1 = todos fallan (DLQ).
type SimulatedEmailSender struct {
	failureRate float64
}

func NewSimulatedEmailSender(failureRate float64) *SimulatedEmailSender {
	return &SimulatedEmailSender{failureRate: failureRate}
}

func (s *SimulatedEmailSender) Send(ctx context.Context, m domain.Message) error {
	time.Sleep(200 * time.Millisecond) // simula la latencia de red
	if rand.Float64() < s.failureRate {
		return errors.New("email provider unavailable (simulated)")
	}
	// Solo registramos ids, nunca datos personales del cliente.
	logger.FromContext(ctx).Info("simulated email sent", zap.String("order_id", m.OrderID))
	return nil
}
