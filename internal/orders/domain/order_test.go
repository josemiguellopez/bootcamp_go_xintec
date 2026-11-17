package domain_test

import (
	"fmt"
	"testing"
	"time"

	"microservice/internal/orders/domain"
	"microservice/pkg/apperrors"
)

var now = time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)

// rut es un RUT válido para las pruebas (dígito verificador correcto).
const rut = "12345678-5"

func validItems() []domain.Item {
	return []domain.Item{
		{SKU: "SKU-1", Quantity: 2, UnitPrice: 1500},
		{SKU: "SKU-2", Quantity: 1, UnitPrice: 999},
	}
}

func TestNewOrder_Valid(t *testing.T) {
	o, err := domain.NewOrder("id-1", " 12.345.678-5 ", validItems(), now)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if o.Status() != domain.StatusEnPreparacion {
		t.Errorf("status = %s, want en_preparacion", o.Status())
	}
	if o.CustomerID() != "12345678-5" {
		t.Errorf("the RUT should be normalized, got %q", o.CustomerID())
	}
	if o.Total() != 2*1500+999 {
		t.Errorf("total = %d, want %d", o.Total(), 2*1500+999)
	}
}

// RF-02: cada regla de validación con su código de error.
func TestNewOrder_Validation(t *testing.T) {
	tooMany := make([]domain.Item, domain.MaxItems+1)
	for i := range tooMany {
		tooMany[i] = domain.Item{SKU: fmt.Sprintf("SKU-%d", i), Quantity: 1, UnitPrice: 1}
	}
	item := func(sku string, qty int, price int64) []domain.Item {
		return []domain.Item{{SKU: sku, Quantity: qty, UnitPrice: price}}
	}

	tests := []struct {
		name     string
		customer string
		items    []domain.Item
		wantCode string
	}{
		{"empty customer", "   ", validItems(), "ORDER_INVALID_CUSTOMER"},
		{"customer is not a RUT", "customer-42", validItems(), "ORDER_INVALID_CUSTOMER"},
		{"RUT with wrong check digit", "12345678-9", validItems(), "ORDER_INVALID_CUSTOMER"},
		{"no items", rut, nil, "ORDER_EMPTY_ITEMS"},
		{"too many items", rut, tooMany, "ORDER_TOO_MANY_ITEMS"},
		{"empty sku", rut, item(" ", 1, 1), "ORDER_INVALID_SKU"},
		{"zero quantity", rut, item("A", 0, 1), "ORDER_INVALID_QUANTITY"},
		{"negative quantity", rut, item("A", -3, 1), "ORDER_INVALID_QUANTITY"},
		{"quantity over limit", rut, item("A", domain.MaxQuantity+1, 1), "ORDER_INVALID_QUANTITY"},
		{"zero price", rut, item("A", 1, 0), "ORDER_INVALID_PRICE"},
		{"negative price", rut, item("A", 1, -100), "ORDER_INVALID_PRICE"},
		{"price over limit", rut, item("A", 1, domain.MaxUnitPrice+1), "ORDER_INVALID_PRICE"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := domain.NewOrder("id", tt.customer, tt.items, now)
			if !apperrors.HasCode(err, tt.wantCode) {
				t.Fatalf("error = %v, want %s", err, tt.wantCode)
			}
		})
	}
}

func TestNormalizeRUT(t *testing.T) {
	valid := map[string]string{
		"12.345.678-5": "12345678-5",
		"12345678-5":   "12345678-5",
		"123456785":    "12345678-5",
		"11.111.111-1": "11111111-1",
		"10.000.013-k": "10000013-K", // dígito verificador K, en minúscula
		"1-9":          "1-9",
	}
	for in, want := range valid {
		if got, ok := domain.NormalizeRUT(in); !ok || got != want {
			t.Errorf("NormalizeRUT(%q) = %q, %v; want %q", in, got, ok, want)
		}
	}
	for _, in := range []string{"", "-", "12345678-9", "abc", "1234567X-5", "0-0", "123456789-0"} {
		if got, ok := domain.NormalizeRUT(in); ok {
			t.Errorf("NormalizeRUT(%q) = %q, should be invalid", in, got)
		}
	}
}

func TestNewOrder_ItemsCannotBeChangedFromOutside(t *testing.T) {
	items := validItems()
	o, _ := domain.NewOrder("id", rut, items, now)
	items[0].Quantity = 999
	o.Items()[0].Quantity = 999
	if o.Items()[0].Quantity != 2 {
		t.Fatal("the order must not change through external slices")
	}
}

func TestNewOrder_BiggestOrderDoesNotOverflow(t *testing.T) {
	items := make([]domain.Item, domain.MaxItems)
	for i := range items {
		items[i] = domain.Item{SKU: fmt.Sprintf("SKU-%d", i), Quantity: domain.MaxQuantity, UnitPrice: domain.MaxUnitPrice}
	}
	o, err := domain.NewOrder("id", rut, items, now)
	if err != nil || o.Total() != int64(domain.MaxItems)*domain.MaxQuantity*domain.MaxUnitPrice {
		t.Fatalf("total = %d, err = %v", o.Total(), err)
	}
}

// El recorrido completo de un pedido, paso a paso.
func TestTransitionTo_HappyPath(t *testing.T) {
	o, _ := domain.NewOrder("id", rut, validItems(), now)
	path := []domain.Status{
		domain.StatusListoParaDespacho,
		domain.StatusEnTransito,
		domain.StatusNoEntregado, // falló el primer intento de entrega
		domain.StatusEnTransito,  // se reintenta
		domain.StatusEntregado,
		domain.StatusDevuelto,
	}
	for _, to := range path {
		from := o.Status()
		if err := o.TransitionTo(to, now); err != nil || o.Status() != to {
			t.Fatalf("%s -> %s should work: status=%s err=%v", from, to, o.Status(), err)
		}
	}
}

// Cualquier salto que no está en la regla devuelve 409 y el pedido no cambia.
func TestTransitionTo_InvalidJumps(t *testing.T) {
	tests := []struct {
		name string
		path []domain.Status // cómo llegar al estado de partida
		to   domain.Status
	}{
		{"skip dispatch", nil, domain.StatusEnTransito},
		{"deliver without transit", nil, domain.StatusEntregado},
		{"back to preparation", []domain.Status{domain.StatusListoParaDespacho}, domain.StatusEnPreparacion},
		{"same status", []domain.Status{domain.StatusListoParaDespacho}, domain.StatusListoParaDespacho},
		{"returned is final", []domain.Status{domain.StatusListoParaDespacho, domain.StatusEnTransito, domain.StatusEntregado, domain.StatusDevuelto}, domain.StatusEnTransito},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			o, _ := domain.NewOrder("id", rut, validItems(), now)
			for _, s := range tt.path {
				if err := o.TransitionTo(s, now); err != nil {
					t.Fatalf("setup %s: %v", s, err)
				}
			}
			before := o.Status()
			if err := o.TransitionTo(tt.to, now); !apperrors.HasCode(err, "ORDER_INVALID_TRANSITION") {
				t.Fatalf("%s -> %s: expected ORDER_INVALID_TRANSITION, got %v", before, tt.to, err)
			}
			if o.Status() != before {
				t.Fatalf("status changed to %s after an invalid transition", o.Status())
			}
		})
	}
}

func TestParseStatus(t *testing.T) {
	if s, err := domain.ParseStatus("en_transito"); err != nil || s != domain.StatusEnTransito {
		t.Fatalf("en_transito: %v %v", s, err)
	}
	for _, bad := range []string{"", "EN_TRANSITO", "PENDING", "perdido"} {
		if _, err := domain.ParseStatus(bad); !apperrors.HasCode(err, "ORDER_INVALID_STATUS") {
			t.Errorf("%q: expected ORDER_INVALID_STATUS, got %v", bad, err)
		}
	}
}
