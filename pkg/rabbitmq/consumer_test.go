package rabbitmq

import (
	"context"
	"errors"
	"testing"
	"time"

	"microservice/pkg/retry"

	"go.uber.org/zap"
)

// fakeAck registra cómo se confirmó el mensaje.
type fakeAck struct {
	acked, nacked, requeue bool
}

func (f *fakeAck) Ack(bool) error { f.acked = true; return nil }
func (f *fakeAck) Nack(_ bool, requeue bool) error {
	f.nacked, f.requeue = true, requeue
	return nil
}

func newTestConsumer(h Handler, maxAttempts int, backoff time.Duration) *Consumer {
	return NewConsumer("amqp://unused", ConsumerConfig{
		Name:  "test",
		Queue: "test.queue",
		Retry: retry.Policy{MaxAttempts: maxAttempts, InitialBackoff: backoff, MaxBackoff: backoff},
	}, h, zap.NewNop())
}

var msg = Delivery{MessageID: "evt-1", Body: []byte(`{}`)}

func TestHandle_SuccessIsAcked(t *testing.T) {
	ack := &fakeAck{}
	newTestConsumer(func(context.Context, Delivery) error { return nil }, 3, time.Millisecond).
		handle(context.Background(), msg, ack)
	if !ack.acked || ack.nacked {
		t.Fatalf("want Ack, got %+v", ack)
	}
}

func TestHandle_TransientErrorIsRetriedThenAcked(t *testing.T) {
	calls := 0
	ack := &fakeAck{}
	newTestConsumer(func(context.Context, Delivery) error {
		calls++
		if calls < 3 {
			return errors.New("db temporarily unavailable")
		}
		return nil
	}, 4, time.Millisecond).handle(context.Background(), msg, ack)

	if calls != 3 || !ack.acked {
		t.Fatalf("calls=%d ack=%+v; want 3 calls and Ack", calls, ack)
	}
}

func TestHandle_ExhaustedRetriesGoToDLQ(t *testing.T) {
	calls := 0
	ack := &fakeAck{}
	newTestConsumer(func(context.Context, Delivery) error {
		calls++
		return errors.New("provider down")
	}, 3, time.Millisecond).handle(context.Background(), msg, ack)

	if calls != 3 || !ack.nacked || ack.requeue {
		t.Fatalf("calls=%d ack=%+v; want 3 calls and Nack(requeue=false)", calls, ack)
	}
}

func TestHandle_PermanentErrorGoesToDLQWithoutRetrying(t *testing.T) {
	calls := 0
	ack := &fakeAck{}
	newTestConsumer(func(context.Context, Delivery) error {
		calls++
		return retry.Permanent(errors.New("malformed"))
	}, 5, time.Millisecond).handle(context.Background(), msg, ack)

	if calls != 1 || !ack.nacked || ack.requeue {
		t.Fatalf("calls=%d ack=%+v; want 1 call and Nack(requeue=false)", calls, ack)
	}
}

func TestHandle_ShutdownDuringRetriesRequeues(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	ack := &fakeAck{}
	newTestConsumer(func(context.Context, Delivery) error {
		cancel() // llega SIGTERM mientras se procesa
		return errors.New("transient")
	}, 5, time.Hour).handle(ctx, msg, ack)

	if !ack.nacked || !ack.requeue {
		t.Fatalf("want Nack(requeue=true), got %+v", ack)
	}
}

func TestHandle_InFlightWorkFinishesDuringShutdown(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	ack := &fakeAck{}
	newTestConsumer(func(handlerCtx context.Context, _ Delivery) error {
		cancel()
		return handlerCtx.Err() // el contexto del intento NO se cancela con el apagado
	}, 3, time.Millisecond).handle(ctx, msg, ack)

	if !ack.acked {
		t.Fatalf("in-flight work should finish and be acked, got %+v", ack)
	}
}

func TestHandle_MessageReceivedAfterShutdownIsReturned(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	called := false
	ack := &fakeAck{}
	newTestConsumer(func(context.Context, Delivery) error { called = true; return nil }, 3, time.Millisecond).
		handle(ctx, msg, ack)

	if called || !ack.requeue {
		t.Fatalf("called=%v ack=%+v; want no processing and Nack(requeue=true)", called, ack)
	}
}
