#!/usr/bin/env bash
# Demostraciones de escenarios de fallo (requiere `docker compose up -d --build`).
# Ejecutar desde Git Bash, Linux o macOS:
#
#   ./scripts/demo.sh idempotency   # el cliente repite el POST
#   ./scripts/demo.sh retries       # el email falla siempre -> reintentos -> DLQ
#   ./scripts/demo.sh worker-down   # el worker está caído cuando llegan pedidos
#   ./scripts/demo.sh shutdown      # se apaga el worker con mensajes en curso
set -euo pipefail

API=http://localhost:3200
BODY='{"customer_id":"customer-demo","items":[{"sku":"SKU-1","quantity":2,"unit_price_cents":1500}]}'

title()     { printf '\n\033[1;36m== %s ==\033[0m\n' "$*"; }
new_order() { curl -s -X POST "$API/orders" -H 'Content-Type: application/json' -d "$BODY" | sed -E 's/.*"id":"([^"]+)".*/\1/'; }
status_of() { curl -s "$API/orders/$1" | sed -E 's/.*"status":"([A-Z]+)".*/\1/'; }
queues()    { docker compose exec -T rabbitmq rabbitmqctl list_queues -q name messages; }

case "${1:-}" in
idempotency)
  KEY="demo-$(date +%s)"
  title "1) Primer POST con Idempotency-Key=$KEY -> 201 Created"
  curl -s -i -X POST "$API/orders" -H 'Content-Type: application/json' -H "Idempotency-Key: $KEY" -d "$BODY" | grep -E '^HTTP|"id"'
  title "2) El cliente no recibió respuesta y reintenta igual -> 200 OK con el MISMO id"
  curl -s -i -X POST "$API/orders" -H 'Content-Type: application/json' -H "Idempotency-Key: $KEY" -d "$BODY" | grep -E '^HTTP|"id"'
  title "Pedidos guardados con esa clave (debe ser 1)"
  docker compose exec -T postgres psql -U postgres -d eventflow -At -c "SELECT COUNT(*) FROM orders WHERE idempotency_key = '$KEY'"
  ;;

retries)
  title "Reinicio el worker con NOTIFIER_FAILURE_RATE=1 (el email falla SIEMPRE)"
  NOTIFIER_FAILURE_RATE=1 docker compose up -d worker
  sleep 5
  ID=$(new_order); echo "pedido: $ID"
  echo "esperando que se agoten los 4 intentos (0,5s + 1s + 2s de espera)..."
  sleep 8
  title "Logs del worker: reintentos con espera creciente y envío a la DLQ"
  docker compose logs worker --since 20s | grep -E 'will retry|dead-letter' || true
  title "Colas: notifications.send.dlq tiene el mensaje"
  queues
  title "El pedido igual se CONFIRMÓ: el worker de pedidos es independiente"
  echo "estado: $(status_of "$ID")"
  title "Restauro el worker (NOTIFIER_FAILURE_RATE=0.3)"
  docker compose up -d worker
  ;;

worker-down)
  title "Detengo el worker"
  docker compose stop worker
  ID=$(new_order); echo "pedido: $ID"
  title "La API respondió igual. El pedido espera en PENDING y el mensaje espera en la cola"
  echo "estado: $(status_of "$ID")"
  queues
  title "Levanto el worker: procesa lo pendiente"
  docker compose start worker
  sleep 6
  echo "estado: $(status_of "$ID")"
  ;;

shutdown)
  title "Encolo 10 pedidos y apago el worker (SIGTERM) mientras los procesa"
  for _ in $(seq 1 10); do new_order >/dev/null; done
  docker compose stop worker
  title "Logs: deja de recibir, termina lo que estaba haciendo y devuelve el resto a la cola"
  docker compose logs worker --since 30s | grep -E 'shutdown|returned to the queue|processed|stopped' | tail -n 15 || true
  title "Mensajes que quedaron en las colas (no se perdieron)"
  queues
  docker compose start worker
  ;;

*)
  sed -n '2,9p' "$0"; exit 1 ;;
esac
