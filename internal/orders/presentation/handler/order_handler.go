// Package handler traduce HTTP <-> casos de uso. Aquí solo se lee/escribe
// JSON y se traducen errores: las reglas de negocio están en el dominio.
package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"microservice/internal/orders/application/dto"
	"microservice/internal/orders/application/usecase"
	"microservice/pkg/apperrors"
	"microservice/pkg/httputil"

	"github.com/gin-gonic/gin"
)

type OrderHandler struct {
	create *usecase.CreateOrderUseCase
	get    *usecase.GetOrderUseCase
}

func NewOrderHandler(create *usecase.CreateOrderUseCase, get *usecase.GetOrderUseCase) *OrderHandler {
	return &OrderHandler{create: create, get: get}
}

// Create maneja POST /orders.
//
//	201 -> pedido creado
//	200 -> la Idempotency-Key ya se usó: se devuelve el pedido original
//	400 -> JSON inválido o datos que no cumplen las reglas
//	413 -> cuerpo demasiado grande
func (h *OrderHandler) Create(c *gin.Context) {
	var req dto.CreateOrderRequest
	if err := decodeJSON(c, &req); err != nil {
		httputil.RespondError(c, err)
		return
	}

	order, created, err := h.create.Execute(c.Request.Context(), req, c.GetHeader("Idempotency-Key"))
	if err != nil {
		httputil.RespondError(c, err)
		return
	}

	if !created {
		c.JSON(http.StatusOK, order)
		return
	}
	c.JSON(http.StatusCreated, order)
}

// Get maneja GET /orders/:id.
func (h *OrderHandler) Get(c *gin.Context) {
	order, err := h.get.Execute(c.Request.Context(), c.Param("id"))
	if err != nil {
		httputil.RespondError(c, err)
		return
	}
	c.JSON(http.StatusOK, order)
}

// decodeJSON lee el cuerpo y rechaza campos desconocidos.
func decodeJSON(c *gin.Context, dst any) error {
	dec := json.NewDecoder(c.Request.Body)
	dec.DisallowUnknownFields()
	err := dec.Decode(dst)
	if err == nil {
		return nil
	}

	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		return apperrors.NewPayloadTooLargeError("PAYLOAD_TOO_LARGE",
			fmt.Sprintf("request body must not exceed %d bytes", tooLarge.Limit))
	}
	return apperrors.NewValidationError("INVALID_JSON", "request body must be a valid JSON order")
}
