-- Estados del pedido definidos por el profesor:
--   en_preparacion, listo_para_despacho, en_transito, entregado, no_entregado, devuelto
-- Los pedidos que ya existían se traducen: PENDING -> en_preparacion y
-- CONFIRMED -> listo_para_despacho.
ALTER TABLE orders DROP CONSTRAINT orders_status_check;

UPDATE orders
SET status = CASE status
    WHEN 'PENDING' THEN 'en_preparacion'
    WHEN 'CONFIRMED' THEN 'listo_para_despacho'
    ELSE status
END;

ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (
    status IN ('en_preparacion', 'listo_para_despacho', 'en_transito', 'entregado', 'no_entregado', 'devuelto')
);
