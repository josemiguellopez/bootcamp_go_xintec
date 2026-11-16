package handler_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"microservice/internal/orders/application/usecase"
	"microservice/internal/orders/ordertest"
	"microservice/internal/orders/presentation/handler"
	"microservice/internal/orders/presentation/router"
	"microservice/pkg/httputil"
	"microservice/pkg/middleware"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

const validBody = `{"customer_id":"customer-1","items":[{"sku":"SKU-1","quantity":2,"unit_price_cents":1500}]}`

// newServer arma la API real (middlewares + handler + casos de uso) con un
// repositorio en memoria en lugar de PostgreSQL.
func newServer(repo *ordertest.MemoryRepo) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(middleware.RequestID(zap.NewNop()), middleware.Recovery(),
		middleware.BodyLimit(1024), middleware.Timeout(time.Second))
	pub := &ordertest.FakePublisher{}
	router.RegisterRoutes(r, handler.NewOrderHandler(
		usecase.NewCreateOrderUseCase(repo, pub), usecase.NewGetOrderUseCase(repo)))
	return r
}

func send(srv http.Handler, method, path, body, idempotencyKey string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if idempotencyKey != "" {
		req.Header.Set("Idempotency-Key", idempotencyKey)
	}
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	return rec
}

func orderID(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	var body struct{ ID string }
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("invalid JSON %q", rec.Body.String())
	}
	return body.ID
}

func errorCode(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	var body httputil.ErrorResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("invalid error JSON %q", rec.Body.String())
	}
	return body.Error.Code
}

// RF-01
func TestCreateOrder_Returns201(t *testing.T) {
	rec := send(newServer(ordertest.NewMemoryRepo()), "POST", "/orders", validBody, "")

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201; body=%s", rec.Code, rec.Body)
	}
	if !strings.Contains(rec.Body.String(), `"status":"PENDING"`) || orderID(t, rec) == "" {
		t.Errorf("unexpected body: %s", rec.Body)
	}
	if rec.Header().Get("X-Request-ID") == "" {
		t.Error("the X-Request-ID header must be set")
	}
}

// RF-02
func TestCreateOrder_InvalidRequestsReturn4xx(t *testing.T) {
	tests := []struct {
		name     string
		body     string
		wantHTTP int
		wantCode string
	}{
		{"malformed json", `{"customer_id":`, 400, "INVALID_JSON"},
		{"empty body", ``, 400, "INVALID_JSON"},
		{"unknown field", `{"customer_id":"c","items":[],"admin":true}`, 400, "INVALID_JSON"},
		{"quantity as text", `{"customer_id":"c","items":[{"sku":"A","quantity":"1","unit_price_cents":1}]}`, 400, "INVALID_JSON"},
		{"missing customer", `{"items":[{"sku":"A","quantity":1,"unit_price_cents":1}]}`, 400, "ORDER_INVALID_CUSTOMER"},
		{"empty items", `{"customer_id":"c","items":[]}`, 400, "ORDER_EMPTY_ITEMS"},
		{"zero quantity", `{"customer_id":"c","items":[{"sku":"A","quantity":0,"unit_price_cents":1}]}`, 400, "ORDER_INVALID_QUANTITY"},
		{"negative price", `{"customer_id":"c","items":[{"sku":"A","quantity":1,"unit_price_cents":-5}]}`, 400, "ORDER_INVALID_PRICE"},
		{"body too large", `{"customer_id":"` + strings.Repeat("x", 2048) + `"}`, 413, "PAYLOAD_TOO_LARGE"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			repo := ordertest.NewMemoryRepo()
			rec := send(newServer(repo), "POST", "/orders", tt.body, "")

			if rec.Code != tt.wantHTTP || errorCode(t, rec) != tt.wantCode {
				t.Fatalf("got %d %s, want %d %s", rec.Code, errorCode(t, rec), tt.wantHTTP, tt.wantCode)
			}
			if repo.Count() != 0 {
				t.Error("no order must be created")
			}
		})
	}
}

// RF-03
func TestGetOrder(t *testing.T) {
	srv := newServer(ordertest.NewMemoryRepo())
	id := orderID(t, send(srv, "POST", "/orders", validBody, ""))

	if rec := send(srv, "GET", "/orders/"+id, "", ""); rec.Code != http.StatusOK || orderID(t, rec) != id {
		t.Fatalf("existing order: %d %s", rec.Code, rec.Body)
	}
	if rec := send(srv, "GET", "/orders/6b2f7f53-6a8e-4e0f-9b43-6a1f1d1f6c11", "", ""); rec.Code != http.StatusNotFound {
		t.Fatalf("missing order: status = %d, want 404", rec.Code)
	}
	if rec := send(srv, "GET", "/orders/abc", "", ""); rec.Code != http.StatusBadRequest {
		t.Fatalf("invalid id: status = %d, want 400", rec.Code)
	}
}

// RF-10: el cliente repite el POST con la misma clave.
func TestCreateOrder_RetryWithSameKey(t *testing.T) {
	repo := ordertest.NewMemoryRepo()
	srv := newServer(repo)

	first := send(srv, "POST", "/orders", validBody, "retry-abc")
	second := send(srv, "POST", "/orders", validBody, "retry-abc")

	if first.Code != http.StatusCreated || second.Code != http.StatusOK {
		t.Fatalf("statuses = %d, %d; want 201, 200", first.Code, second.Code)
	}
	if orderID(t, first) != orderID(t, second) || repo.Count() != 1 {
		t.Fatalf("a retry must return the same order and not create another (orders=%d)", repo.Count())
	}
}

// RF-10: muchos reintentos simultáneos con la misma clave.
func TestCreateOrder_ConcurrentRetriesWithSameKey(t *testing.T) {
	repo := ordertest.NewMemoryRepo()
	srv := newServer(repo)

	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			send(srv, "POST", "/orders", validBody, "same-key")
		}()
	}
	wg.Wait()

	if repo.Count() != 1 {
		t.Fatalf("orders = %d, want exactly 1", repo.Count())
	}
}

// RF-05: un error de la base de datos no se muestra al cliente.
func TestDatabaseErrorDoesNotLeakDetails(t *testing.T) {
	repo := ordertest.NewMemoryRepo()
	repo.Err = errors.New(`relation "orders" does not exist; password=s3cret host=db.internal`)
	rec := send(newServer(repo), "POST", "/orders", validBody, "")

	if rec.Code != http.StatusInternalServerError || errorCode(t, rec) != "INTERNAL_ERROR" {
		t.Fatalf("got %d %s, want 500 INTERNAL_ERROR", rec.Code, rec.Body)
	}
	for _, secret := range []string{"relation", "s3cret", "db.internal"} {
		if strings.Contains(rec.Body.String(), secret) {
			t.Fatalf("response leaks %q: %s", secret, rec.Body)
		}
	}
}

// Nivel 2: si la base tarda más que el timeout, se responde 503.
func TestTimeoutReturns503(t *testing.T) {
	repo := ordertest.NewMemoryRepo()
	repo.Err = fmt.Errorf("select order: %w", context.DeadlineExceeded)
	rec := send(newServer(repo), "GET", "/orders/6b2f7f53-6a8e-4e0f-9b43-6a1f1d1f6c11", "", "")
	if rec.Code != http.StatusServiceUnavailable || errorCode(t, rec) != "TIMEOUT" {
		t.Fatalf("got %d %s, want 503 TIMEOUT", rec.Code, rec.Body)
	}
}
