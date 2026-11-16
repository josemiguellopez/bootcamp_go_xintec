// Package app arma el proceso de la API: configuración, base de datos,
// RabbitMQ, router HTTP y apagado ordenado.
package app

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"microservice/cmd/config"
	"microservice/cmd/container"
	"microservice/cmd/routes"
	"microservice/migrations"
	"microservice/pkg/database"
	"microservice/pkg/logger"
	"microservice/pkg/middleware"
	"microservice/pkg/rabbitmq"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"go.uber.org/zap"
)

type App struct {
	config    *config.Configuration
	log       *zap.Logger
	pool      *pgxpool.Pool
	publisher *rabbitmq.Publisher
	server    *http.Server
}

func New(ctx context.Context) (*App, error) {
	if err := config.LoadEnvFile(); err != nil {
		return nil, err
	}
	cfg, err := config.LoadVars()
	if err != nil {
		return nil, err
	}
	log, err := logger.New("eventflow-api", cfg.LogLevel)
	if err != nil {
		return nil, err
	}
	logger.SetGlobal(log)

	pool, err := database.NewPostgresPool(ctx, database.PostgresConfig{
		Host: cfg.DBHost, Port: cfg.DBPort, User: cfg.DBUser,
		Password: cfg.DBPassword, DBName: cfg.DBName, SSLMode: cfg.DBSSLMode,
	})
	if err != nil {
		return nil, err
	}
	if err := database.Migrate(ctx, pool, migrations.FS, log); err != nil {
		pool.Close()
		return nil, err
	}

	publisher := rabbitmq.NewPublisher(cfg.RabbitMQURL)
	c := container.NewContainer(pool, publisher)

	if cfg.AppEnv == "prod" {
		gin.SetMode(gin.ReleaseMode)
	}
	router := gin.New()
	router.NoRoute(middleware.NotFound())
	router.Use(
		middleware.RequestID(log),
		middleware.AccessLog(),
		middleware.Recovery(),
		middleware.SecurityHeaders(),
		middleware.BodyLimit(cfg.MaxBodyBytes),
		middleware.Timeout(cfg.RequestTimeout),
	)
	routes.ConfigureModules(router, c)

	return &App{
		config:    cfg,
		log:       log,
		pool:      pool,
		publisher: publisher,
		server: &http.Server{
			Addr:              ":" + strconv.Itoa(cfg.Port),
			Handler:           router,
			ReadHeaderTimeout: 5 * time.Second,  // límites para no quedar colgados
			ReadTimeout:       10 * time.Second, // con clientes lentos
			WriteTimeout:      15 * time.Second,
		},
	}, nil
}
