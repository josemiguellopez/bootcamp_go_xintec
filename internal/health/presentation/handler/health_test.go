package handler

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestReady(t *testing.T) {
	tests := []struct {
		name string
		ping func(context.Context) error
		want int
	}{
		{"database up", func(context.Context) error { return nil }, http.StatusOK},
		{"database down", func(context.Context) error { return errors.New("down") }, http.StatusServiceUnavailable},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			NewHealthHandler(tt.ping).Ready(rec, httptest.NewRequest(http.MethodGet, "/ready", nil))
			if rec.Code != tt.want {
				t.Fatalf("status = %d, want %d", rec.Code, tt.want)
			}
		})
	}
}

func TestLive(t *testing.T) {
	rec := httptest.NewRecorder()
	NewHealthHandler(nil).Live(rec, httptest.NewRequest(http.MethodGet, "/health", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
}
