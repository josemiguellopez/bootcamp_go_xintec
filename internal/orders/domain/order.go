// Package domain contiene las reglas de negocio de los pedidos.
// No depende de HTTP, SQL ni RabbitMQ: se puede probar sin nada de eso.
package domain

import (
	"fmt"
	"strings"
	"time"

	"microservice/pkg/apperrors"
)

// Límites de negocio. Con ellos el total máximo es 100 * 10.000 * 1e8 = 1e14,
// muy por debajo del máximo de int64, así que la suma nunca se desborda.
const (
	MaxItems          = 100
	MaxQuantity       = 10_000
	MaxUnitPriceCents = 100_000_000
	MaxCustomerIDLen  = 64
)

type Status string

const (
	StatusPending   Status = "PENDING"   // recién creado
	StatusConfirmed Status = "CONFIRMED" // procesado por el worker de pedidos
)

// Item es una línea del pedido. Los precios van en centavos (enteros) para
// evitar errores de redondeo con decimales.
type Item struct {
	SKU            string
	Quantity       int
	UnitPriceCents int64
}

func (i Item) SubtotalCents() int64 { return int64(i.Quantity) * i.UnitPriceCents }

// Order tiene sus campos privados: solo se puede crear válido (NewOrder) y
// solo cambia de estado con sus métodos (Confirm).
type Order struct {
	id         string
	customerID string
	items      []Item
	status     Status
	createdAt  time.Time
	updatedAt  time.Time
}

// NewOrder valida los datos (RF-02) y crea el pedido en estado PENDING.
func NewOrder(id, customerID string, items []Item, now time.Time) (*Order, error) {
	customerID = strings.TrimSpace(customerID)
	if customerID == "" || len(customerID) > MaxCustomerIDLen {
		return nil, apperrors.NewValidationError("ORDER_INVALID_CUSTOMER",
			fmt.Sprintf("customer_id is required and must have at most %d characters", MaxCustomerIDLen))
	}
	if len(items) == 0 {
		return nil, apperrors.NewValidationError("ORDER_EMPTY_ITEMS", "items must contain at least one item")
	}
	if len(items) > MaxItems {
		return nil, apperrors.NewValidationError("ORDER_TOO_MANY_ITEMS",
			fmt.Sprintf("items must contain at most %d items", MaxItems))
	}
	for i, it := range items {
		if strings.TrimSpace(it.SKU) == "" {
			return nil, apperrors.NewValidationError("ORDER_INVALID_SKU", fmt.Sprintf("items[%d].sku is required", i))
		}
		if it.Quantity < 1 || it.Quantity > MaxQuantity {
			return nil, apperrors.NewValidationError("ORDER_INVALID_QUANTITY",
				fmt.Sprintf("items[%d].quantity must be between 1 and %d", i, MaxQuantity))
		}
		if it.UnitPriceCents < 1 || it.UnitPriceCents > MaxUnitPriceCents {
			return nil, apperrors.NewValidationError("ORDER_INVALID_PRICE",
				fmt.Sprintf("items[%d].unit_price_cents must be between 1 and %d", i, MaxUnitPriceCents))
		}
	}

	// PostgreSQL guarda microsegundos: truncamos para que lo que devolvemos al
	// crear sea igual a lo que se lee después.
	now = now.UTC().Truncate(time.Microsecond)
	return &Order{
		id:         id,
		customerID: customerID,
		items:      append([]Item(nil), items...), // copia: nadie puede cambiarlo desde afuera
		status:     StatusPending,
		createdAt:  now,
		updatedAt:  now,
	}, nil
}

// Rehydrate reconstruye un pedido leído de la base de datos.
func Rehydrate(id, customerID string, items []Item, status Status, createdAt, updatedAt time.Time) *Order {
	return &Order{id: id, customerID: customerID, items: items, status: status, createdAt: createdAt, updatedAt: updatedAt}
}

// Confirm aplica la única transición permitida: PENDING -> CONFIRMED.
func (o *Order) Confirm(now time.Time) error {
	if o.status != StatusPending {
		return apperrors.NewConflictError("ORDER_INVALID_TRANSITION",
			fmt.Sprintf("order cannot be confirmed from status %s", o.status))
	}
	o.status = StatusConfirmed
	o.updatedAt = now.UTC().Truncate(time.Microsecond)
	return nil
}

func (o *Order) ID() string           { return o.id }
func (o *Order) CustomerID() string   { return o.customerID }
func (o *Order) Status() Status       { return o.status }
func (o *Order) CreatedAt() time.Time { return o.createdAt }
func (o *Order) UpdatedAt() time.Time { return o.updatedAt }
func (o *Order) Items() []Item        { return append([]Item(nil), o.items...) }

// TotalCents suma los subtotales de todos los artículos.
func (o *Order) TotalCents() int64 {
	var total int64
	for _, it := range o.items {
		total += it.SubtotalCents()
	}
	return total
}
