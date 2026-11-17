package usecase

import (
	"context"
	"errors"
	"strings"
	"testing"

	"microservice/internal/orders/application/dto"
	"microservice/internal/orders/ordertest"
	"microservice/pkg/apperrors"
	"microservice/pkg/correlation"
)

func validRequest() dto.CreateOrderRequest {
	return dto.CreateOrderRequest{
		CustomerID: "12345678-5",
		Items:      []dto.OrderItemRequest{{SKU: "SKU-1", Quantity: 2, UnitPrice: 1000}},
	}
}

func TestCreateOrder_SavesAndPublishesEvent(t *testing.T) {
	repo, pub := ordertest.NewMemoryRepo(), &ordertest.FakePublisher{}
	ctx := correlation.WithID(context.Background(), "req-123")

	order, created, err := NewCreateOrderUseCase(repo, pub).Execute(ctx, validRequest(), "")
	if err != nil || !created {
		t.Fatalf("created=%v err=%v", created, err)
	}
	if order.Status != "en_preparacion" || order.Total != 2000 || repo.Count() != 1 {
		t.Errorf("unexpected order: %+v", order)
	}
	if pub.Count() != 1 {
		t.Fatalf("expected 1 event, got %d", pub.Count())
	}
	e := pub.Events[0]
	if e.OrderID != order.ID || e.CorrelationID != "req-123" || e.EventID == "" || e.OccurredAt.IsZero() {
		t.Errorf("unexpected event: %+v", e)
	}
}

func TestCreateOrder_InvalidDataCreatesNothing(t *testing.T) {
	repo, pub := ordertest.NewMemoryRepo(), &ordertest.FakePublisher{}
	req := validRequest()
	req.Items[0].Quantity = 0

	_, _, err := NewCreateOrderUseCase(repo, pub).Execute(context.Background(), req, "")
	if !apperrors.HasCode(err, "ORDER_INVALID_QUANTITY") {
		t.Fatalf("expected ORDER_INVALID_QUANTITY, got %v", err)
	}
	if repo.Count() != 0 || pub.Count() != 0 {
		t.Fatal("nothing must be saved or published")
	}
}

func TestCreateOrder_SameIdempotencyKeyReturnsSameOrder(t *testing.T) {
	repo, pub := ordertest.NewMemoryRepo(), &ordertest.FakePublisher{}
	uc := NewCreateOrderUseCase(repo, pub)

	first, created1, _ := uc.Execute(context.Background(), validRequest(), "key-1")
	second, created2, err := uc.Execute(context.Background(), validRequest(), "key-1")

	if err != nil || !created1 || created2 || first.ID != second.ID {
		t.Fatalf("first=%s (created=%v) second=%s (created=%v) err=%v", first.ID, created1, second.ID, created2, err)
	}
	if repo.Count() != 1 || pub.Count() != 1 {
		t.Fatalf("a retry must not create orders or events: orders=%d events=%d", repo.Count(), pub.Count())
	}
}

func TestCreateOrder_WithoutKeyCreatesTwoOrders(t *testing.T) {
	// Comportamiento documentado: sin Idempotency-Key no hay protección.
	repo, pub := ordertest.NewMemoryRepo(), &ordertest.FakePublisher{}
	uc := NewCreateOrderUseCase(repo, pub)
	_, _, _ = uc.Execute(context.Background(), validRequest(), "")
	_, _, _ = uc.Execute(context.Background(), validRequest(), "")
	if repo.Count() != 2 {
		t.Fatalf("orders = %d, want 2", repo.Count())
	}
}

func TestCreateOrder_KeyTooLong(t *testing.T) {
	uc := NewCreateOrderUseCase(ordertest.NewMemoryRepo(), &ordertest.FakePublisher{})
	_, _, err := uc.Execute(context.Background(), validRequest(), strings.Repeat("k", MaxIdempotencyKeyLen+1))
	if !apperrors.HasCode(err, "IDEMPOTENCY_KEY_INVALID") {
		t.Fatalf("expected IDEMPOTENCY_KEY_INVALID, got %v", err)
	}
}

func TestCreateOrder_BrokerDownStillSavesOrder(t *testing.T) {
	// Brecha conocida (ver README): el pedido se guarda y se responde OK,
	// pero el evento no se publica y el pedido queda en_preparacion.
	repo := ordertest.NewMemoryRepo()
	pub := &ordertest.FakePublisher{Err: errors.New("connection refused")}

	order, created, err := NewCreateOrderUseCase(repo, pub).Execute(context.Background(), validRequest(), "")
	if err != nil || !created || repo.Count() != 1 || order.Status != "en_preparacion" {
		t.Fatalf("created=%v err=%v orders=%d", created, err, repo.Count())
	}
}

// Pregunta 1 del desafío: el cliente corta la conexión justo después de que
// el pedido se guardó. El evento se tiene que publicar igual; si no, el
// pedido quedaría en_preparacion para siempre.
func TestCreateOrder_ClientDisconnectStillPublishesEvent(t *testing.T) {
	repo, pub := ordertest.NewMemoryRepo(), &ordertest.FakePublisher{}
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // el cliente se fue

	_, created, err := NewCreateOrderUseCase(repo, pub).Execute(ctx, validRequest(), "")
	if err != nil || !created {
		t.Fatalf("created=%v err=%v", created, err)
	}
	if pub.Count() != 1 {
		t.Fatalf("events = %d, want 1: the event must be published even if the client disconnected", pub.Count())
	}
}

func TestCreateOrder_DatabaseErrorIsReturned(t *testing.T) {
	repo := ordertest.NewMemoryRepo()
	repo.Err = errors.New("connection refused")
	_, _, err := NewCreateOrderUseCase(repo, &ordertest.FakePublisher{}).Execute(context.Background(), validRequest(), "")
	if !errors.Is(err, repo.Err) {
		t.Fatalf("expected the database error, got %v", err)
	}
}
