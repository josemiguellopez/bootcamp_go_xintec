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
	MaxItems     = 100
	MaxQuantity  = 10_000
	MaxUnitPrice = 100_000_000
)

// Currency es la moneda de todos los montos: pesos chilenos. El CLP no usa
// decimales, así que precios y totales son enteros (8990 = $8.990) y no hay
// errores de redondeo.
const Currency = "CLP"

// Item es una línea del pedido. UnitPrice está en pesos chilenos (entero).
type Item struct {
	SKU       string
	Quantity  int
	UnitPrice int64
}

func (i Item) Subtotal() int64 { return int64(i.Quantity) * i.UnitPrice }

// Order tiene sus campos privados: solo se puede crear válido (NewOrder) y
// solo cambia de estado con TransitionTo, que respeta las reglas de status.go.
type Order struct {
	id         string
	customerID string
	items      []Item
	status     Status
	createdAt  time.Time
	updatedAt  time.Time
}

// NewOrder valida los datos (RF-02) y crea el pedido en estado en_preparacion.
// El cliente se identifica con su RUT, que se guarda normalizado (12345678-5).
func NewOrder(id, customerRUT string, items []Item, now time.Time) (*Order, error) {
	customerID, ok := NormalizeRUT(customerRUT)
	if !ok {
		return nil, apperrors.NewValidationError("ORDER_INVALID_CUSTOMER",
			"customer_id must be a valid Chilean RUT, for example 12345678-5")
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
		if it.UnitPrice < 1 || it.UnitPrice > MaxUnitPrice {
			return nil, apperrors.NewValidationError("ORDER_INVALID_PRICE",
				fmt.Sprintf("items[%d].unit_price must be between 1 and %d", i, MaxUnitPrice))
		}
	}

	// PostgreSQL guarda microsegundos: truncamos para que lo que devolvemos al
	// crear sea igual a lo que se lee después.
	now = now.UTC().Truncate(time.Microsecond)
	return &Order{
		id:         id,
		customerID: customerID,
		items:      append([]Item(nil), items...), // copia: nadie puede cambiarlo desde afuera
		status:     StatusEnPreparacion,
		createdAt:  now,
		updatedAt:  now,
	}, nil
}

// Rehydrate reconstruye un pedido leído de la base de datos.
func Rehydrate(id, customerID string, items []Item, status Status, createdAt, updatedAt time.Time) *Order {
	return &Order{id: id, customerID: customerID, items: items, status: status, createdAt: createdAt, updatedAt: updatedAt}
}

// TransitionTo cambia el estado si la regla lo permite (ver status.go).
// Si no, devuelve ORDER_INVALID_TRANSITION (HTTP 409) y el pedido no cambia.
func (o *Order) TransitionTo(to Status, now time.Time) error {
	if !CanTransition(o.status, to) {
		return errInvalidTransition(o.status, to)
	}
	o.status = to
	o.updatedAt = now.UTC().Truncate(time.Microsecond)
	return nil
}

func (o *Order) ID() string           { return o.id }
func (o *Order) CustomerID() string   { return o.customerID }
func (o *Order) Status() Status       { return o.status }
func (o *Order) CreatedAt() time.Time { return o.createdAt }
func (o *Order) UpdatedAt() time.Time { return o.updatedAt }
func (o *Order) Items() []Item        { return append([]Item(nil), o.items...) }

// Total suma los subtotales de todos los artículos.
func (o *Order) Total() int64 {
	var total int64
	for _, it := range o.items {
		total += it.Subtotal()
	}
	return total
}
