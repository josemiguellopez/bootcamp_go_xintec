// Package handler expone los health checks. Usa net/http puro para servir
// tanto a la API (Gin) como al worker.
package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"time"
)

type HealthHandler struct {
	pingDB func(ctx context.Context) error
}

// NewHealthHandler recibe la función que comprueba la base de datos
// (por ejemplo pool.Ping).
func NewHealthHandler(pingDB func(ctx context.Context) error) *HealthHandler {
	return &HealthHandler{pingDB: pingDB}
}

// Live: el proceso está vivo. Siempre 200.
func (h *HealthHandler) Live(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "up"})
}

// Ready: el proceso puede atender trabajo. 200 si la base responde, 503 si no.
func (h *HealthHandler) Ready(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	if err := h.pingDB(ctx); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "down", "database": "down"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "up", "database": "up"})
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
