//go:build integration

// Package dbtest prepara una base PostgreSQL real para pruebas de
// integración. Requiere TEST_DATABASE_URL (ver README: make test-integration).
package dbtest

import (
	"context"
	"os"
	"testing"

	"microservice/migrations"
	"microservice/pkg/database"

	"github.com/jackc/pgx/v5/pgxpool"
	"go.uber.org/zap"
)

// URL devuelve TEST_DATABASE_URL u omite la prueba si no está definida.
func URL(t *testing.T) string {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set; run `make test-integration`")
	}
	return url
}

// Pool abre un pool, aplica migraciones y vacía las tablas de negocio.
func Pool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, URL(t))
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)

	if err := database.Migrate(ctx, pool, migrations.FS, zap.NewNop()); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	if _, err := pool.Exec(ctx, `TRUNCATE orders, order_items, notifications`); err != nil {
		t.Fatalf("truncate: %v", err)
	}
	return pool
}
