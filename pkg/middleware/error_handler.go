package middleware

import (
	"net/http"

	"microservice/pkg/httputil"
	"microservice/pkg/logger"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

// Recovery captura un panic, lo registra con su stack y responde un 500
// genérico (sin mostrar el detalle al cliente).
func Recovery() gin.HandlerFunc {
	return gin.CustomRecoveryWithWriter(nil, func(c *gin.Context, recovered any) {
		logger.FromContext(c.Request.Context()).Error("panic recovered",
			zap.Any("panic", recovered), zap.Stack("stack"))
		httputil.Abort(c, http.StatusInternalServerError, httputil.ErrorDetail{
			Type: "INTERNAL_ERROR", Code: "INTERNAL_ERROR", Message: "Internal server error",
		})
	})
}

// NotFound responde las rutas inexistentes con el formato de error común.
func NotFound() gin.HandlerFunc {
	return func(c *gin.Context) {
		httputil.Abort(c, http.StatusNotFound, httputil.ErrorDetail{
			Type: "NOT_FOUND", Code: "ROUTE_NOT_FOUND", Message: "Route not found",
		})
	}
}
