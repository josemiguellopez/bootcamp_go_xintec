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
	SKU            string `json:"sku"`
	Quantity       int    `json:"quantity"`
	UnitPriceCents int64  `json:"unit_price_cents"`
}

type OrderResponse struct {
	ID         string              `json:"id"`
	CustomerID string              `json:"customer_id"`
	Status     string              `json:"status"`
	TotalCents int64               `json:"total_cents"`
	Items      []OrderItemResponse `json:"items"`
	CreatedAt  time.Time           `json:"created_at"`
	UpdatedAt  time.Time           `json:"updated_at"`
}

type OrderItemResponse struct {
	SKU            string `json:"sku"`
	Quantity       int    `json:"quantity"`
	UnitPriceCents int64  `json:"unit_price_cents"`
	SubtotalCents  int64  `json:"subtotal_cents"`
}

// FromOrder mapea el agregado a su representación de salida.
func FromOrder(o *domain.Order) OrderResponse {
	items := o.Items()
	out := make([]OrderItemResponse, len(items))
	for i, it := range items {
		out[i] = OrderItemResponse{
			SKU:            it.SKU,
			Quantity:       it.Quantity,
			UnitPriceCents: it.UnitPriceCents,
			SubtotalCents:  it.SubtotalCents(),
		}
	}
	return OrderResponse{
		ID:         o.ID(),
		CustomerID: o.CustomerID(),
		Status:     string(o.Status()),
		TotalCents: o.TotalCents(),
		Items:      out,
		CreatedAt:  o.CreatedAt(),
		UpdatedAt:  o.UpdatedAt(),
	}
}
