//go:build integration

// Pruebas contra un PostgreSQL real. Ver docs/03-pruebas.md para ejecutarlas.
package infrastructure_test

import (
	"context"
	"sync"
	"testing"

	"microservice/internal/orders/application/dto"
	"microservice/internal/orders/application/usecase"
	"microservice/internal/orders/domain"
	"microservice/internal/orders/infrastructure"
	"microservice/internal/orders/ordertest"
	"microservice/migrations"
	"microservice/pkg/apperrors"
	"microservice/pkg/database"
	"microservice/pkg/database/dbtest"

	"github.com/jackc/pgx/v5/pgxpool"
	"go.uber.org/zap"
)

var request = dto.CreateOrderRequest{
	CustomerID: "customer-1",
	Items: []dto.OrderItemRequest{
		{SKU: "SKU-1", Quantity: 2, UnitPriceCents: 1500},
		{SKU: "SKU-2", Quantity: 1, UnitPriceCents: 999},
	},
}

func TestMigrationsCanRunTwice(t *testing.T) {
	pool := dbtest.Pool(t) // ya aplicó las migraciones una vez
	if err := database.Migrate(context.Background(), pool, migrations.FS, zap.NewNop()); err != nil {
		t.Fatalf("running migrations again should do nothing, got %v", err)
	}
}

// RF-04: el pedido sigue ahí con una conexión nueva (como tras reiniciar la API).
func TestOrderSurvivesRestart(t *testing.T) {
	pool := dbtest.Pool(t)
	created, _, err := usecase.NewCreateOrderUseCase(infrastructure.NewPostgresOrderRepository(pool), &ordertest.FakePublisher{}).
		Execute(context.Background(), request, "")
	if err != nil {
		t.Fatal(err)
	}
	pool.Close()

	fresh, err := pgxpool.New(context.Background(), dbtest.URL(t))
	if err != nil {
		t.Fatal(err)
	}
	defer fresh.Close()

	got, err := usecase.NewGetOrderUseCase(infrastructure.NewPostgresOrderRepository(fresh)).
		Execute(context.Background(), created.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.TotalCents != 3999 || len(got.Items) != 2 || got.Items[0].SKU != "SKU-1" || !got.CreatedAt.Equal(created.CreatedAt) {
		t.Fatalf("stored order differs:\n got  %+v\n want %+v", got, created)
	}
}

// RF-10: 20 peticiones simultáneas con la misma clave crean un solo pedido.
func TestConcurrentRequestsWithSameKeyCreateOneOrder(t *testing.T) {
	pool := dbtest.Pool(t)
	pub := &ordertest.FakePublisher{}
	uc := usecase.NewCreateOrderUseCase(infrastructure.NewPostgresOrderRepository(pool), pub)

	var (
		wg  sync.WaitGroup
		mu  sync.Mutex
		ids = map[string]bool{}
	)
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			order, _, err := uc.Execute(context.Background(), request, "same-key")
			if err != nil {
				t.Errorf("Execute: %v", err)
				return
			}
			mu.Lock()
			ids[order.ID] = true
			mu.Unlock()
		}()
	}
	wg.Wait()

	var count int
	_ = pool.QueryRow(context.Background(), `SELECT COUNT(*) FROM orders`).Scan(&count)
	if count != 1 || len(ids) != 1 || pub.Count() != 1 {
		t.Fatalf("orders=%d distinct ids=%d events=%d; want 1, 1, 1", count, len(ids), pub.Count())
	}
}

// RF-12: procesar el mismo evento dos veces deja el pedido igual.
func TestConfirmTwiceIsSafe(t *testing.T) {
	pool := dbtest.Pool(t)
	repo := infrastructure.NewPostgresOrderRepository(pool)
	created, _, err := usecase.NewCreateOrderUseCase(repo, &ordertest.FakePublisher{}).Execute(context.Background(), request, "")
	if err != nil {
		t.Fatal(err)
	}
	confirm := usecase.NewConfirmOrderUseCase(repo)

	if already, err := confirm.Execute(context.Background(), created.ID); err != nil || already {
		t.Fatalf("first: already=%v err=%v", already, err)
	}
	if already, err := confirm.Execute(context.Background(), created.ID); err != nil || !already {
		t.Fatalf("duplicate: already=%v err=%v", already, err)
	}
	o, _ := repo.FindByID(context.Background(), created.ID)
	if o.Status() != domain.StatusConfirmed {
		t.Fatalf("status = %s", o.Status())
	}
}

func TestFindByID_NotFound(t *testing.T) {
	pool := dbtest.Pool(t)
	_, err := infrastructure.NewPostgresOrderRepository(pool).FindByID(context.Background(), "6b2f7f53-6a8e-4e0f-9b43-6a1f1d1f6c11")
	if !apperrors.HasCode(err, domain.CodeOrderNotFound) {
		t.Fatalf("expected ORDER_NOT_FOUND, got %v", err)
	}
}
