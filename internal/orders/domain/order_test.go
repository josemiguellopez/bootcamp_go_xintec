package domain_test

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"microservice/internal/orders/domain"
	"microservice/pkg/apperrors"
)

var now = time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)

func validItems() []domain.Item {
	return []domain.Item{
		{SKU: "SKU-1", Quantity: 2, UnitPriceCents: 1500},
		{SKU: "SKU-2", Quantity: 1, UnitPriceCents: 999},
	}
}

func TestNewOrder_Valid(t *testing.T) {
	o, err := domain.NewOrder("id-1", "  customer-42 ", validItems(), now)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if o.Status() != domain.StatusPending {
		t.Errorf("status = %s, want PENDING", o.Status())
	}
	if o.CustomerID() != "customer-42" {
		t.Errorf("customer_id should be trimmed, got %q", o.CustomerID())
	}
	if o.TotalCents() != 2*1500+999 {
		t.Errorf("total = %d, want %d", o.TotalCents(), 2*1500+999)
	}
}

// RF-02: cada regla de validación con su código de error.
func TestNewOrder_Validation(t *testing.T) {
	tooMany := make([]domain.Item, domain.MaxItems+1)
	for i := range tooMany {
		tooMany[i] = domain.Item{SKU: fmt.Sprintf("SKU-%d", i), Quantity: 1, UnitPriceCents: 1}
	}
	item := func(sku string, qty int, price int64) []domain.Item {
		return []domain.Item{{SKU: sku, Quantity: qty, UnitPriceCents: price}}
	}

	tests := []struct {
		name     string
		customer string
		items    []domain.Item
		wantCode string
	}{
		{"empty customer", "   ", validItems(), "ORDER_INVALID_CUSTOMER"},
		{"customer too long", strings.Repeat("c", domain.MaxCustomerIDLen+1), validItems(), "ORDER_INVALID_CUSTOMER"},
		{"no items", "c", nil, "ORDER_EMPTY_ITEMS"},
		{"too many items", "c", tooMany, "ORDER_TOO_MANY_ITEMS"},
		{"empty sku", "c", item(" ", 1, 1), "ORDER_INVALID_SKU"},
		{"zero quantity", "c", item("A", 0, 1), "ORDER_INVALID_QUANTITY"},
		{"negative quantity", "c", item("A", -3, 1), "ORDER_INVALID_QUANTITY"},
		{"quantity over limit", "c", item("A", domain.MaxQuantity+1, 1), "ORDER_INVALID_QUANTITY"},
		{"zero price", "c", item("A", 1, 0), "ORDER_INVALID_PRICE"},
		{"negative price", "c", item("A", 1, -100), "ORDER_INVALID_PRICE"},
		{"price over limit", "c", item("A", 1, domain.MaxUnitPriceCents+1), "ORDER_INVALID_PRICE"},
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

func TestNewOrder_ItemsCannotBeChangedFromOutside(t *testing.T) {
	items := validItems()
	o, _ := domain.NewOrder("id", "c", items, now)
	items[0].Quantity = 999
	o.Items()[0].Quantity = 999
	if o.Items()[0].Quantity != 2 {
		t.Fatal("the order must not change through external slices")
	}
}

func TestNewOrder_BiggestOrderDoesNotOverflow(t *testing.T) {
	items := make([]domain.Item, domain.MaxItems)
	for i := range items {
		items[i] = domain.Item{SKU: fmt.Sprintf("SKU-%d", i), Quantity: domain.MaxQuantity, UnitPriceCents: domain.MaxUnitPriceCents}
	}
	o, err := domain.NewOrder("id", "c", items, now)
	if err != nil || o.TotalCents() != int64(domain.MaxItems)*domain.MaxQuantity*domain.MaxUnitPriceCents {
		t.Fatalf("total = %d, err = %v", o.TotalCents(), err)
	}
}

func TestConfirm_OnlyFromPending(t *testing.T) {
	o, _ := domain.NewOrder("id", "c", validItems(), now)

	if err := o.Confirm(now); err != nil || o.Status() != domain.StatusConfirmed {
		t.Fatalf("PENDING -> CONFIRMED should work: status=%s err=%v", o.Status(), err)
	}
	if err := o.Confirm(now); !apperrors.HasCode(err, "ORDER_INVALID_TRANSITION") {
		t.Fatalf("CONFIRMED -> CONFIRMED should fail, got %v", err)
	}
}
