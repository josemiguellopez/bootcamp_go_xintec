package rabbitmq

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"microservice/pkg/correlation"
	"microservice/pkg/logger"
	"microservice/pkg/metrics"
	"microservice/pkg/retry"

	"go.uber.org/zap"
)

// Delivery es el mensaje tal como lo recibe un Handler.
type Delivery struct {
	MessageID     string
	CorrelationID string
	Body          []byte
	Redelivered   bool // true si RabbitMQ ya lo había entregado antes
}

// Handler procesa un mensaje:
//   - nil                    -> terminado, se confirma (ACK)
//   - error                  -> fallo transitorio, se reintenta
//   - retry.Permanent(error) -> no tiene arreglo, va directo a la DLQ
type Handler func(ctx context.Context, d Delivery) error

type ConsumerConfig struct {
	Name         string        // para logs
	Queue        string        // cola a consumir
	Concurrency  int           // mensajes en paralelo
	Retry        retry.Policy  // reintentos ante errores transitorios
	DrainTimeout time.Duration // espera máxima por los mensajes en curso al apagar
}

// Consumer consume una cola con confirmación manual (RF-12):
//
//	éxito                              -> Ack
//	error transitorio                  -> reintento con espera creciente
//	reintentos agotados o permanente   -> Nack(requeue=false) -> cola .dlq
//	apagado durante los reintentos     -> Nack(requeue=true): vuelve a la cola
//	el proceso muere antes del Ack     -> RabbitMQ lo vuelve a entregar
//
// Como un mensaje puede llegar más de una vez, los handlers deben ser
// idempotentes.
type Consumer struct {
	url     string
	cfg     ConsumerConfig
	handler Handler
	log     *zap.Logger
}

func NewConsumer(url string, cfg ConsumerConfig, h Handler, log *zap.Logger) *Consumer {
	if cfg.Concurrency < 1 {
		cfg.Concurrency = 1
	}
	return &Consumer{url: url, cfg: cfg, handler: h, log: log.With(zap.String("consumer", cfg.Name))}
}

// Run consume hasta que ctx se cancele (devuelve nil) o hasta perder la
// conexión con RabbitMQ (devuelve error; el proceso termina y Docker lo
// reinicia, en vez de tener lógica de reconexión propia).
func (c *Consumer) Run(ctx context.Context) error {
	conn, err := Dial(c.url)
	if err != nil {
		return err
	}
	defer conn.Close() // al cerrar, RabbitMQ devuelve a la cola lo que quedó sin ACK

	ch, err := conn.Channel()
	if err != nil {
		return fmt.Errorf("open channel: %w", err)
	}
	if err := DeclareTopology(ch); err != nil {
		return err
	}
	// Prefetch: RabbitMQ no nos entrega más mensajes de los que podemos procesar.
	if err := ch.Qos(c.cfg.Concurrency, 0, false); err != nil {
		return fmt.Errorf("set prefetch: %w", err)
	}
	deliveries, err := ch.Consume(c.cfg.Queue, c.cfg.Name, false, false, false, false, nil)
	if err != nil {
		return fmt.Errorf("consume %s: %w", c.cfg.Queue, err)
	}
	c.log.Info("consumer started", zap.String("queue", c.cfg.Queue), zap.Int("concurrency", c.cfg.Concurrency))

	// Concurrency goroutines leen del mismo canal de entregas.
	var wg sync.WaitGroup
	for i := 0; i < c.cfg.Concurrency; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for d := range deliveries {
				c.handle(ctx, Delivery{
					MessageID:     d.MessageId,
					CorrelationID: d.CorrelationId,
					Body:          d.Body,
					Redelivered:   d.Redelivered,
				}, d)
			}
		}()
	}
	done := make(chan struct{})
	go func() { wg.Wait(); close(done) }()

	select {
	case <-ctx.Done():
		// Apagado (RF-14): no recibimos más mensajes y esperamos los que están en curso.
		c.log.Info("shutdown requested, finishing in-flight messages")
		_ = ch.Cancel(c.cfg.Name, false)
		select {
		case <-done:
		case <-time.After(c.cfg.DrainTimeout):
			c.log.Warn("drain timeout; unfinished messages will be redelivered")
		}
		return nil
	case <-done:
		// El canal de entregas se cerró sin que pidiéramos apagar: se perdió la conexión.
		return errors.New("rabbitmq connection lost")
	}
}

// acknowledger es la parte de amqp.Delivery que usamos (así se puede probar sin RabbitMQ).
type acknowledger interface {
	Ack(multiple bool) error
	Nack(multiple, requeue bool) error
}

// handle procesa un mensaje con reintentos y decide cómo confirmarlo.
// ctx se cancela al apagar: el intento en curso termina, pero no se empiezan
// intentos nuevos.
func (c *Consumer) handle(ctx context.Context, d Delivery, ack acknowledger) {
	log := c.log.With(
		zap.String("event_id", d.MessageID),
		zap.String("correlation_id", d.CorrelationID),
		zap.Bool("redelivered", d.Redelivered),
	)

	if ctx.Err() != nil {
		_ = ack.Nack(false, true) // ya estamos apagando: lo devolvemos sin tocarlo
		return
	}

	// El intento usa un contexto que NO se cancela con el apagado, pero tiene
	// un límite de tiempo propio para no quedar colgado.
	handlerCtx := correlation.WithID(context.WithoutCancel(ctx), d.CorrelationID)
	handlerCtx = logger.WithContext(handlerCtx, log)

	attempts, err := retry.Do(ctx, c.cfg.Retry, func() error {
		attemptCtx, cancel := context.WithTimeout(handlerCtx, 10*time.Second)
		defer cancel()
		return c.handler(attemptCtx, d)
	}, func(attempt int, err error, wait time.Duration) {
		metrics.Inc(metrics.MessagesRetried)
		log.Warn("message failed, will retry", zap.Int("attempt", attempt), zap.Duration("wait", wait), zap.Error(err))
	})

	switch {
	case err == nil:
		_ = ack.Ack(false)
		metrics.Inc(metrics.MessagesProcessed)
		log.Info("message processed", zap.Int("attempts", attempts))
	case errors.Is(err, retry.ErrAborted):
		_ = ack.Nack(false, true)
		log.Warn("shutdown during retries, message returned to the queue", zap.Error(err))
	default:
		_ = ack.Nack(false, false)
		metrics.Inc(metrics.MessagesDeadLettered)
		log.Error("message sent to dead-letter queue",
			zap.Int("attempts", attempts), zap.Bool("permanent", retry.IsPermanent(err)), zap.Error(err))
	}
}
