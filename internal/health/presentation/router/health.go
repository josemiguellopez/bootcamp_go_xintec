package router

import (
	"net/http"

	"microservice/internal/health/presentation/handler"
	"microservice/pkg/metrics"
)

// Routes arma las rutas de operación: /health, /ready y /metrics.
// La API las monta en Gin y el worker las sirve directamente.
func Routes(h *handler.HealthHandler) *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", h.Live)
	mux.HandleFunc("GET /ready", h.Ready)
	mux.Handle("GET /metrics", metrics.Handler())
	return mux
}
