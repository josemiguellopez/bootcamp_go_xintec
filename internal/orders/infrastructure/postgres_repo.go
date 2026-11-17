// Package infrastructure implementa los puertos del dominio de pedidos:
// PostgreSQL para guardar y RabbitMQ para publicar eventos.
package infrastructure

import (
	"context"
	"errors"
	"fmt"
	"time"

	"microservice/internal/orders/domain"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type PostgresOrderRepository struct {
	pool *pgxpool.Pool
}

func NewPostgresOrderRepository(pool *pgxpool.Pool) *PostgresOrderRepository {
	return &PostgresOrderRepository{pool: pool}
}

// Create guarda el pedido y sus artículos en una transacción.
//
// Idempotencia: la columna idempotency_key es UNIQUE. Con "ON CONFLICT DO
// NOTHING", si la clave ya existe el INSERT no hace nada (0 filas) y
// devolvemos el pedido original. Si llegan dos peticiones con la misma clave
// a la vez, PostgreSQL hace esperar a la segunda hasta que la primera termine,
// así que nunca se crean dos pedidos.
func (r *PostgresOrderRepository) Create(ctx context.Context, o *domain.Order, key string) (*domain.Order, bool, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, false, err
	}
	defer tx.Rollback(context.WithoutCancel(ctx)) //nolint:errcheck // no hace nada si ya hubo Commit

	tag, err := tx.Exec(ctx, `
		INSERT INTO orders (id, customer_id, status, total, idempotency_key, created_at, updated_at)
		VALUES ($1, $2, $3, $4, NULLIF($5, ''), $6, $7)
		ON CONFLICT (idempotency_key) DO NOTHING`,
		o.ID(), o.CustomerID(), string(o.Status()), o.Total(), key, o.CreatedAt(), o.UpdatedAt())
	if err != nil {
		return nil, false, fmt.Errorf("insert order: %w", err)
	}

	if tag.RowsAffected() == 0 { // la clave ya se había usado
		_ = tx.Rollback(ctx)
		var existingID string
		if err := r.pool.QueryRow(ctx,
			`SELECT id::text FROM orders WHERE idempotency_key = $1`, key).Scan(&existingID); err != nil {
			return nil, false, fmt.Errorf("find order by idempotency key: %w", err)
		}
		existing, err := r.FindByID(ctx, existingID)
		return existing, false, err
	}

	for i, it := range o.Items() {
		if _, err := tx.Exec(ctx, `
			INSERT INTO order_items (order_id, position, sku, quantity, unit_price)
			VALUES ($1, $2, $3, $4, $5)`,
			o.ID(), i, it.SKU, it.Quantity, it.UnitPrice); err != nil {
			return nil, false, fmt.Errorf("insert order item: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, false, fmt.Errorf("commit: %w", err)
	}
	return o, true, nil
}

func (r *PostgresOrderRepository) FindByID(ctx context.Context, id string) (*domain.Order, error) {
	return findOrder(ctx, r.pool, selectOrder, id)
}

// UpdateStatus usa SELECT ... FOR UPDATE: si dos workers reciben el mismo
// mensaje a la vez, el segundo espera al primero y ve el estado ya cambiado.
func (r *PostgresOrderRepository) UpdateStatus(ctx context.Context, id string, change func(*domain.Order) error) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(context.WithoutCancel(ctx)) //nolint:errcheck

	o, err := findOrder(ctx, tx, selectOrderForUpdate, id)
	if err != nil {
		return err
	}
	if err := change(o); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE orders SET status = $2, updated_at = $3 WHERE id = $1`,
		o.ID(), string(o.Status()), o.UpdatedAt()); err != nil {
		return fmt.Errorf("update order: %w", err)
	}
	return tx.Commit(ctx)
}

// querier lo cumplen tanto el pool como una transacción.
type querier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

// Las dos consultas posibles para leer un pedido. La segunda además bloquea
// la fila hasta que termine la transacción (la usa UpdateStatus).
const (
	selectOrder          = `SELECT customer_id, status, created_at, updated_at FROM orders WHERE id = $1`
	selectOrderForUpdate = `SELECT customer_id, status, created_at, updated_at FROM orders WHERE id = $1 FOR UPDATE`
)

// findOrder lee el pedido con la consulta indicada (selectOrder o
// selectOrderForUpdate) y luego sus artículos.
func findOrder(ctx context.Context, q querier, query, id string) (*domain.Order, error) {
	var (
		customerID, status   string
		createdAt, updatedAt time.Time
	)
	err := q.QueryRow(ctx, query, id).Scan(&customerID, &status, &createdAt, &updatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrOrderNotFound()
	}
	if err != nil {
		return nil, fmt.Errorf("select order: %w", err)
	}

	rows, err := q.Query(ctx,
		`SELECT sku, quantity, unit_price FROM order_items WHERE order_id = $1 ORDER BY position`, id)
	if err != nil {
		return nil, fmt.Errorf("select items: %w", err)
	}
	var items []domain.Item
	for rows.Next() {
		var it domain.Item
		if err := rows.Scan(&it.SKU, &it.Quantity, &it.UnitPrice); err != nil {
			rows.Close()
			return nil, fmt.Errorf("scan item: %w", err)
		}
		items = append(items, it)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read items: %w", err)
	}

	return domain.Rehydrate(id, customerID, items, domain.Status(status), createdAt.UTC(), updatedAt.UTC()), nil
}
