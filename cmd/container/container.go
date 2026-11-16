// Package container crea las implementaciones concretas y las conecta entre sí
// (inyección de dependencias por constructor, como en la semilla).
package container

import (
	healthHandler "microservice/internal/health/presentation/handler"
	orderUseCase "microservice/internal/orders/application/usecase"
	orderInfra "microservice/internal/orders/infrastructure"
	orderHandler "microservice/internal/orders/presentation/handler"
	"microservice/pkg/rabbitmq"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Container struct {
	HealthHandler *healthHandler.HealthHandler
	OrderHandler  *orderHandler.OrderHandler
}

func NewContainer(pool *pgxpool.Pool, publisher *rabbitmq.Publisher) *Container {
	repo := orderInfra.NewPostgresOrderRepository(pool)
	events := orderInfra.NewRabbitMQEventPublisher(publisher)

	return &Container{
		HealthHandler: healthHandler.NewHealthHandler(pool.Ping),
		OrderHandler: orderHandler.NewOrderHandler(
			orderUseCase.NewCreateOrderUseCase(repo, events),
			orderUseCase.NewGetOrderUseCase(repo),
		),
	}
}
