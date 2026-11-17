// Package dto define los datos de entrada y salida de los casos de uso de
// pedidos (y el formato JSON de la API).
package dto

import (
	"time"

	"microservice/internal/orders/domain"
)

type CreateOrderRequest struct {
	CustomerID string             `json:"customer_id"`
	Items      []OrderItemRequest `json:"items"`
}

type OrderItemRequest struct {
	SKU       string `json:"sku"`
	Quantity  int    `json:"quantity"`
	UnitPrice int64  `json:"unit_price"`
}

// ChangeStatusRequest es el cuerpo de PATCH /orders/{id}/status.
type ChangeStatusRequest struct {
	Status string `json:"status"`
}

type OrderResponse struct {
	ID         string `json:"id"`
	CustomerID string `json:"customer_id"` // RUT normalizado, p. ej. 12345678-5
	Status     string `json:"status"`
	// NextStatuses son los estados a los que se puede pasar desde el actual,
	// para que el cliente sepa qué botones mostrar.
	NextStatuses []string            `json:"next_statuses"`
	Total        int64               `json:"total"`    // en pesos chilenos (entero)
	Currency     string              `json:"currency"` // siempre "CLP"
	Items        []OrderItemResponse `json:"items"`
	CreatedAt    time.Time           `json:"created_at"`
	UpdatedAt    time.Time           `json:"updated_at"`
}

type OrderItemResponse struct {
	SKU       string `json:"sku"`
	Quantity  int    `json:"quantity"`
	UnitPrice int64  `json:"unit_price"`
	Subtotal  int64  `json:"subtotal"`
}

// FromOrder mapea el agregado a su representación de salida.
func FromOrder(o *domain.Order) OrderResponse {
	items := o.Items()
	out := make([]OrderItemResponse, len(items))
	for i, it := range items {
		out[i] = OrderItemResponse{
			SKU:       it.SKU,
			Quantity:  it.Quantity,
			UnitPrice: it.UnitPrice,
			Subtotal:  it.Subtotal(),
		}
	}
	next := []string{} // [] y no null en el JSON cuando no hay siguiente estado
	for _, s := range domain.NextStatuses(o.Status()) {
		next = append(next, string(s))
	}
	return OrderResponse{
		ID:           o.ID(),
		CustomerID:   o.CustomerID(),
		Status:       string(o.Status()),
		NextStatuses: next,
		Total:        o.Total(),
		Currency:     domain.Currency,
		Items:        out,
		CreatedAt:    o.CreatedAt(),
		UpdatedAt:    o.UpdatedAt(),
	}
}
