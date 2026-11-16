package middleware

import (
	"context"
	"net/http"
	"time"

	"microservice/pkg/correlation"
	"microservice/pkg/logger"
	"microservice/pkg/metrics"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

// RequestID asigna un id a cada petición (o usa el X-Request-ID del cliente
// si es válido), lo devuelve en la respuesta y lo guarda en el contexto. Ese
// mismo id viaja después dentro del evento como correlation_id.
func RequestID(base *zap.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := correlation.Sanitize(c.GetHeader("X-Request-ID"))
		c.Header("X-Request-ID", id)

		ctx := correlation.WithID(c.Request.Context(), id)
		ctx = logger.WithContext(ctx, base.With(zap.String("request_id", id)))
		c.Request = c.Request.WithContext(ctx)
		c.Next()
	}
}

// AccessLog escribe una línea de log por petición. No registra cuerpos ni
// cabeceras para no guardar datos sensibles.
func AccessLog() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()

		status := c.Writer.Status()
		metrics.Inc(metrics.HTTPRequests)
		if status >= 500 {
			metrics.Inc(metrics.HTTPServerErrors)
		}
		logger.FromContext(c.Request.Context()).Info("http request",
			zap.String("method", c.Request.Method),
			zap.String("route", c.FullPath()),
			zap.Int("status", status),
			zap.Duration("latency", time.Since(start)),
		)
	}
}

// Timeout limita cuánto puede durar cada petición. Al vencer, el contexto se
// cancela y las consultas a la base de datos se abortan.
func Timeout(d time.Duration) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx, cancel := context.WithTimeout(c.Request.Context(), d)
		defer cancel()
		c.Request = c.Request.WithContext(ctx)
		c.Next()
	}
}

// BodyLimit impide leer cuerpos de más de maxBytes.
func BodyLimit(maxBytes int64) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxBytes)
		c.Next()
	}
}
