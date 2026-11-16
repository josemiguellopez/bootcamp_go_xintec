// Package infrastructure implementa los puertos de notificaciones.
package infrastructure

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type PostgresNotificationRepository struct {
	pool *pgxpool.Pool
}

func NewPostgresNotificationRepository(pool *pgxpool.Pool) *PostgresNotificationRepository {
	return &PostgresNotificationRepository{pool: pool}
}

func (r *PostgresNotificationRepository) AlreadySent(ctx context.Context, eventID string) (bool, error) {
	var exists bool
	err := r.pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM notifications WHERE event_id = $1)`, eventID).Scan(&exists)
	return exists, err
}

// MarkSent no falla si el evento ya estaba registrado (UNIQUE + ON CONFLICT).
func (r *PostgresNotificationRepository) MarkSent(ctx context.Context, eventID, orderID string) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO notifications (id, event_id, order_id, sent_at) VALUES ($1, $2, $3, $4)
		ON CONFLICT (event_id) DO NOTHING`,
		uuid.NewString(), eventID, orderID, time.Now().UTC())
	return err
}
