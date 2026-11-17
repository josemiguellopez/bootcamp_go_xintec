# Atajos. Si no tienes make (p. ej. Windows), cada comando está escrito en
# docs/03-pruebas.md para copiarlo directamente.

TEST_DATABASE_URL ?= postgres://postgres:postgres@localhost:5432/eventflow_test?sslmode=disable
TEST_RABBITMQ_URL ?= amqp://guest:guest@localhost:5672/

.PHONY: up down logs test test-integration vet vuln

up: ## Levanta todo (postgres, rabbitmq, api, worker)
	docker compose up -d --build

down: ## Detiene todo
	docker compose down

logs: ## Muestra los logs de api y worker
	docker compose logs -f api worker

test: ## Pruebas unitarias y HTTP (no necesitan Docker)
	go test ./...

test-integration: ## Pruebas con PostgreSQL y RabbitMQ reales
	docker compose up -d postgres rabbitmq
	-docker compose stop api worker # el worker escucharía las mismas colas que la prueba de punta a punta
	-docker compose exec -T postgres createdb -U postgres eventflow_test
	TEST_DATABASE_URL="$(TEST_DATABASE_URL)" TEST_RABBITMQ_URL="$(TEST_RABBITMQ_URL)" \
		go test -tags integration -p 1 -count=1 ./...

vet: ## Análisis estático
	go vet ./... && go vet -tags integration ./...

vuln: ## Vulnerabilidades conocidas en Go y en las dependencias
	go run golang.org/x/vuln/cmd/govulncheck@v1.1.4 ./...
