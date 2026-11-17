#!/usr/bin/env bash
# Prueba cada contrato de la API (docs/07-contratos.md) y marca ✓ o ✗.
# Requiere el sistema levantado: docker compose up -d --build
#
#   ./scripts/contratos.sh                 # contra localhost
#   API=http://otra:3200 WORKER=http://otra:3201 ./scripts/contratos.sh
#
# Termina con código 1 si algún contrato no se cumple.
set -uo pipefail

API=${API:-http://localhost:3200}
WORKER=${WORKER:-http://localhost:3201}
KEY="contrato-$(date +%s)-$RANDOM"
OK=0
FAIL=0
BODY_FILE=$(mktemp)
BIG_FILE=$(mktemp)
trap 'rm -f "$BODY_FILE" "$BIG_FILE"' EXIT

# check "descripción" código_esperado "texto_esperado_en_el_cuerpo" -- argumentos de curl
check() {
  local name=$1 want=$2 text=$3
  shift 4
  local got
  : >"$BODY_FILE"
  got=$(curl -s -o "$BODY_FILE" -w '%{http_code}' "$@")
  if [[ $got == "$want" ]] && grep -q -- "$text" "$BODY_FILE"; then
    printf '  \033[32m✓\033[0m %-62s %s\n' "$name" "$got"
    OK=$((OK + 1))
  else
    printf '  \033[31m✗\033[0m %-62s esperaba %s con «%s», llegó %s\n' "$name" "$want" "$text" "$got"
    printf '      %s\n' "$(head -c 300 "$BODY_FILE")"
    FAIL=$((FAIL + 1))
  fi
}

json=(-H 'Content-Type: application/json')
ORDER='{"customer_id":"12.345.678-5","items":[{"sku":"GO-TAZA","quantity":2,"unit_price":8990},{"sku":"GO-STICKERS","quantity":1,"unit_price":2990}]}'

echo "== POST /orders: crear"
check "201 pedido válido (RUT con puntos, 2 productos)" 201 '"status":"en_preparacion"' -- \
  -X POST "$API/orders" "${json[@]}" -H "Idempotency-Key: $KEY" -d "$ORDER"
ID=$(sed -E 's/.*"id":"([^"]+)".*/\1/' "$BODY_FILE")
check "    total = 2×8990 + 2990 = 20970 CLP, RUT guardado sin puntos" 201 '"total":20970,"currency":"CLP"' -- \
  -X POST "$API/orders" "${json[@]}" -d "$ORDER"
check "200 misma Idempotency-Key devuelve el mismo pedido" 200 "\"id\":\"$ID\"" -- \
  -X POST "$API/orders" "${json[@]}" -H "Idempotency-Key: $KEY" -d "$ORDER"

echo "== POST /orders: datos inválidos (no se crea nada)"
check "400 RUT con dígito verificador incorrecto" 400 ORDER_INVALID_CUSTOMER -- \
  -X POST "$API/orders" "${json[@]}" -d '{"customer_id":"12345678-9","items":[{"sku":"A","quantity":1,"unit_price":100}]}'
check "400 lista de productos vacía" 400 ORDER_EMPTY_ITEMS -- \
  -X POST "$API/orders" "${json[@]}" -d '{"customer_id":"12345678-5","items":[]}'
check "400 cantidad 0" 400 ORDER_INVALID_QUANTITY -- \
  -X POST "$API/orders" "${json[@]}" -d '{"customer_id":"12345678-5","items":[{"sku":"A","quantity":0,"unit_price":100}]}'
check "400 precio negativo" 400 ORDER_INVALID_PRICE -- \
  -X POST "$API/orders" "${json[@]}" -d '{"customer_id":"12345678-5","items":[{"sku":"A","quantity":1,"unit_price":-5}]}'
check "400 sku vacío" 400 ORDER_INVALID_SKU -- \
  -X POST "$API/orders" "${json[@]}" -d '{"customer_id":"12345678-5","items":[{"sku":"","quantity":1,"unit_price":100}]}'
check "400 JSON mal formado" 400 INVALID_JSON -- \
  -X POST "$API/orders" "${json[@]}" -d '{"customer_id": '
check "400 campo desconocido" 400 INVALID_JSON -- \
  -X POST "$API/orders" "${json[@]}" -d '{"customer_id":"12345678-5","items":[{"sku":"A","quantity":1,"unit_price":1}],"descuento":10}'
check "400 Idempotency-Key de 129 caracteres" 400 IDEMPOTENCY_KEY_INVALID -- \
  -X POST "$API/orders" "${json[@]}" -H "Idempotency-Key: $(printf 'k%.0s' {1..129})" -d "$ORDER"
# 70 KB desde un archivo (como argumento no cabe en la línea de comandos de Windows)
printf '{"customer_id":"%s","items":[]}' "$(head -c 70000 /dev/zero | tr '\0' 'x')" >"$BIG_FILE"
check "413 cuerpo de 70 KB (límite 64 KB)" 413 PAYLOAD_TOO_LARGE -- \
  -X POST "$API/orders" "${json[@]}" --data-binary "@$BIG_FILE"

echo "== GET /orders/{id}"
for _ in $(seq 1 20); do # el worker lo deja listo en menos de un segundo
  curl -s "$API/orders/$ID" | grep -q listo_para_despacho && break
  sleep 0.5
done
check "200 el worker lo dejó listo_para_despacho" 200 '"status":"listo_para_despacho"' -- "$API/orders/$ID"
check "404 UUID que no existe" 404 ORDER_NOT_FOUND -- "$API/orders/00000000-0000-4000-8000-000000000000"
check "400 id que no es UUID" 400 ORDER_INVALID_ID -- "$API/orders/abc"

echo "== PATCH /orders/{id}/status: el recorrido completo"
patch() { check "$1" "$2" "$3" -- -X PATCH "$API/orders/$ID/status" "${json[@]}" -d "{\"status\":\"$4\"}"; }
patch "409 salto no permitido: listo_para_despacho → entregado" 409 ORDER_INVALID_TRANSITION entregado
patch "200 listo_para_despacho → en_transito" 200 '"status":"en_transito"' en_transito
patch "200 en_transito → no_entregado" 200 '"status":"no_entregado"' no_entregado
patch "200 no_entregado → en_transito (reintento de entrega)" 200 '"status":"en_transito"' en_transito
patch "200 en_transito → entregado" 200 '"status":"entregado"' entregado
patch "200 entregado → devuelto" 200 '"next_statuses":\[\]' devuelto
patch "409 devuelto es final: devuelto → en_transito" 409 ORDER_INVALID_TRANSITION en_transito
patch "400 estado que no existe" 400 ORDER_INVALID_STATUS perdido
check "404 pedido que no existe" 404 ORDER_NOT_FOUND -- \
  -X PATCH "$API/orders/00000000-0000-4000-8000-000000000000/status" "${json[@]}" -d '{"status":"en_transito"}'

echo "== Operación"
check "200 GET /health (API viva)" 200 '"status":"up"' -- "$API/health"
check "200 GET /ready (base de datos disponible)" 200 '"database":"up"' -- "$API/ready"
check "200 GET /metrics (contadores)" 200 orders_created_total -- "$API/metrics"
check "200 worker GET /health" 200 '"status":"up"' -- "$WORKER/health"
check "200 worker GET /ready" 200 '"database":"up"' -- "$WORKER/ready"
check "200 worker GET /metrics" 200 messages_processed_total -- "$WORKER/metrics"
check "404 ruta que no existe" 404 ROUTE_NOT_FOUND -- "$API/esta-ruta-no-existe"
RID="contrato-$RANDOM"
got=$(curl -s -D - -o /dev/null -H "X-Request-ID: $RID" "$API/health" | tr -d '\r' | grep -i '^X-Request-Id:' | cut -d' ' -f2)
if [[ $got == "$RID" ]]; then
  printf '  \033[32m✓\033[0m %-62s %s\n' "X-Request-ID propio vuelve en la respuesta" "$got"
  OK=$((OK + 1))
else
  printf '  \033[31m✗\033[0m %-62s envié %s, volvió %s\n' "X-Request-ID propio vuelve en la respuesta" "$RID" "$got"
  FAIL=$((FAIL + 1))
fi

echo
echo "Resultado: $OK cumplen, $FAIL no cumplen. Pedido de prueba: $ID"
[[ $FAIL -eq 0 ]]
