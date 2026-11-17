-- Los montos son pesos chilenos (CLP). El CLP no usa decimales, así que ya no
-- hablamos de "centavos": 8990 significa $8.990. Solo cambian los nombres de
-- las columnas; los datos y las reglas (CHECK > 0) se conservan.
ALTER TABLE orders RENAME COLUMN total_cents TO total;
ALTER TABLE order_items RENAME COLUMN unit_price_cents TO unit_price;
