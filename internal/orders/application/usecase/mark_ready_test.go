package usecase

import (
	"context"
	"testing"

	"microservice/internal/orders/domain"
	"microservice/internal/orders/ordertest"
	"microservice/pkg/apperrors"
)

const missingID = "6b2f7f53-6a8e-4e0f-9b43-6a1f1d1f6c11"

func createOrder(t *testing.T, repo *ordertest.MemoryRepo) string {
	t.Helper()
	order, _, err := NewCreateOrderUseCase(repo, &ordertest.FakePublisher{}).Execute(context.Background(), validRequest(), "")
	if err != nil {
		t.Fatal(err)
	}
	return order.ID
}

func TestMarkReady(t *testing.T) {
	repo := ordertest.NewMemoryRepo()
	id := createOrder(t, repo)
	uc := NewMarkReadyUseCase(repo)

	already, err := uc.Execute(context.Background(), id)
	if err != nil || already {
		t.Fatalf("first time: already=%v err=%v", already, err)
	}
	o, _ := repo.FindByID(context.Background(), id)
	if o.Status() != domain.StatusListoParaDespacho {
		t.Fatalf("status = %s, want listo_para_despacho", o.Status())
	}

	// El mismo mensaje llega otra vez (duplicado): no cambia nada.
	already, err = uc.Execute(context.Background(), id)
	if err != nil || !already {
		t.Fatalf("duplicate: already=%v err=%v; want already=true", already, err)
	}
}

func TestMarkReady_UnknownOrder(t *testing.T) {
	_, err := NewMarkReadyUseCase(ordertest.NewMemoryRepo()).Execute(context.Background(), missingID)
	if !apperrors.HasCode(err, domain.CodeOrderNotFound) {
		t.Fatalf("expected ORDER_NOT_FOUND, got %v", err)
	}
}

func TestGetOrder(t *testing.T) {
	repo := ordertest.NewMemoryRepo()
	id := createOrder(t, repo)
	uc := NewGetOrderUseCase(repo)

	if got, err := uc.Execute(context.Background(), id); err != nil || got.ID != id {
		t.Fatalf("existing: %+v %v", got, err)
	}
	if _, err := uc.Execute(context.Background(), "not-a-uuid"); !apperrors.HasCode(err, "ORDER_INVALID_ID") {
		t.Errorf("expected ORDER_INVALID_ID, got %v", err)
	}
	if _, err := uc.Execute(context.Background(), missingID); !apperrors.HasCode(err, domain.CodeOrderNotFound) {
		t.Errorf("expected ORDER_NOT_FOUND, got %v", err)
	}
}
