-- Notificaciones enviadas. UNIQUE(event_id) evita notificar dos veces el
-- mismo evento si RabbitMQ lo entrega duplicado.
CREATE TABLE notifications (
    id       UUID PRIMARY KEY,
    event_id UUID        NOT NULL UNIQUE,
    order_id UUID        NOT NULL,
    sent_at  TIMESTAMPTZ NOT NULL
);
