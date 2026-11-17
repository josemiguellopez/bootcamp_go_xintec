package usecase

import (
	"context"
	"slices"
	"testing"

	"microservice/internal/orders/application/dto"
	"microservice/internal/orders/domain"
	"microservice/internal/orders/ordertest"
	"microservice/pkg/apperrors"
)

func TestChangeStatus_FollowsTheRules(t *testing.T) {
	repo := ordertest.NewMemoryRepo()
	id := createOrder(t, repo)
	_, _ = NewMarkReadyUseCase(repo).Execute(context.Background(), id) // lo que haría el worker
	uc := NewChangeStatusUseCase(repo)

	got, err := uc.Execute(context.Background(), id, dto.ChangeStatusRequest{Status: "en_transito"})
	if err != nil || got.Status != "en_transito" {
		t.Fatalf("listo_para_despacho -> en_transito: %+v %v", got, err)
	}
	if !slices.Equal(got.NextStatuses, []string{"entregado", "no_entregado"}) {
		t.Errorf("next_statuses = %v", got.NextStatuses)
	}

	// Saltar de en_transito a en_preparacion no está permitido: 409 y nada cambia.
	_, err = uc.Execute(context.Background(), id, dto.ChangeStatusRequest{Status: "en_preparacion"})
	if !apperrors.HasCode(err, "ORDER_INVALID_TRANSITION") {
		t.Fatalf("expected ORDER_INVALID_TRANSITION, got %v", err)
	}
	o, _ := repo.FindByID(context.Background(), id)
	if o.Status() != domain.StatusEnTransito {
		t.Fatalf("status = %s after an invalid change", o.Status())
	}
}

func TestChangeStatus_BadInput(t *testing.T) {
	repo := ordertest.NewMemoryRepo()
	id := createOrder(t, repo)
	uc := NewChangeStatusUseCase(repo)

	tests := []struct {
		name, id, status, wantCode string
	}{
		{"unknown status", id, "perdido", "ORDER_INVALID_STATUS"},
		{"id is not a UUID", "abc", "en_transito", "ORDER_INVALID_ID"},
		{"order does not exist", missingID, "listo_para_despacho", domain.CodeOrderNotFound},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := uc.Execute(context.Background(), tt.id, dto.ChangeStatusRequest{Status: tt.status})
			if !apperrors.HasCode(err, tt.wantCode) {
				t.Fatalf("expected %s, got %v", tt.wantCode, err)
			}
		})
	}
}

// Si alguien ya movió el pedido a mano, el evento que llega tarde no lo pisa.
func TestMarkReady_IgnoresOrdersThatAlreadyMoved(t *testing.T) {
	repo := ordertest.NewMemoryRepo()
	id := createOrder(t, repo)
	uc := NewChangeStatusUseCase(repo)
	_, _ = uc.Execute(context.Background(), id, dto.ChangeStatusRequest{Status: "listo_para_despacho"})
	_, _ = uc.Execute(context.Background(), id, dto.ChangeStatusRequest{Status: "en_transito"})

	already, err := NewMarkReadyUseCase(repo).Execute(context.Background(), id)
	if err != nil || !already {
		t.Fatalf("already=%v err=%v; want already=true", already, err)
	}
	o, _ := repo.FindByID(context.Background(), id)
	if o.Status() != domain.StatusEnTransito {
		t.Fatalf("status = %s, the late event must not change it", o.Status())
	}
}
