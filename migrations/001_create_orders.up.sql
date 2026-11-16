-- Pedidos y sus artículos. Los importes se guardan en centavos (BIGINT)
-- para evitar errores de redondeo de punto flotante.
CREATE TABLE orders (
    id              UUID PRIMARY KEY,
    customer_id     TEXT        NOT NULL,
    status          TEXT        NOT NULL CHECK (status IN ('PENDING', 'CONFIRMED')),
    total_cents     BIGINT      NOT NULL CHECK (total_cents > 0),
    -- Idempotencia (RF-10): una misma clave solo puede crear un pedido.
    idempotency_key TEXT        NULL UNIQUE,
    created_at      TIMESTAMPTZ NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL
);

CREATE TABLE order_items (
    order_id         UUID   NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
    position         INT    NOT NULL,
    sku              TEXT   NOT NULL,
    quantity         INT    NOT NULL CHECK (quantity > 0),
    unit_price_cents BIGINT NOT NULL CHECK (unit_price_cents > 0),
    PRIMARY KEY (order_id, position)
);
