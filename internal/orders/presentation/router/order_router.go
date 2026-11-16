package router

import (
	"microservice/internal/orders/presentation/handler"

	"github.com/gin-gonic/gin"
)

func RegisterRoutes(r gin.IRouter, h *handler.OrderHandler) {
	r.POST("/orders", h.Create)
	r.GET("/orders/:id", h.Get)
}
