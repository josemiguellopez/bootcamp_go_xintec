package routes

import (
	"microservice/cmd/container"
	health "microservice/internal/health/presentation/router"
	orders "microservice/internal/orders/presentation/router"

	"github.com/gin-gonic/gin"
)

// ConfigureModules registra las rutas de cada módulo.
func ConfigureModules(r *gin.Engine, c *container.Container) {
	ops := gin.WrapH(health.Routes(c.HealthHandler))
	r.GET("/health", ops)
	r.GET("/ready", ops)
	r.GET("/metrics", ops)

	orders.RegisterRoutes(r, c.OrderHandler)
}
