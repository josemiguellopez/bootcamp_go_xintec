# ================================
# STAGE 1: build (api + worker)
# ================================
FROM golang:1.26.11-alpine AS builder
WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/api \
 && CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/worker ./cmd/worker

# ================================
# STAGE 2: runtime (sin shell, usuario no root)
# ================================
FROM gcr.io/distroless/static-debian12:nonroot

COPY --from=builder /out/api /api
COPY --from=builder /out/worker /worker

ENV ENVIRONMENT=prod
EXPOSE 3200 3201
# Por defecto arranca la API; el worker usa la misma imagen con entrypoint /worker.
ENTRYPOINT ["/api"]
