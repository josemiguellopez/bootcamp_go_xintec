package rabbitmq

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"microservice/pkg/events"

	amqp "github.com/rabbitmq/amqp091-go"
)

// Message es lo que se publica.
type Message struct {
	ID            string
	Type          string
	CorrelationID string
	Body          []byte
}

// Publisher publica en el exchange de eventos usando "publisher confirms":
// Publish solo devuelve nil cuando RabbitMQ confirmó que guardó el mensaje.
// Si la conexión se cae, se vuelve a abrir en la siguiente publicación.
type Publisher struct {
	url  string
	mu   sync.Mutex // un canal AMQP no se debe usar desde varias goroutines a la vez
	conn *amqp.Connection
	ch   *amqp.Channel
}

func NewPublisher(url string) *Publisher {
	return &Publisher{url: url}
}

func (p *Publisher) Publish(ctx context.Context, m Message) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	if err := p.connect(); err != nil {
		return err
	}

	confirm, err := p.ch.PublishWithDeferredConfirmWithContext(ctx, events.Exchange, m.Type, false, false,
		amqp.Publishing{
			ContentType:   "application/json",
			DeliveryMode:  amqp.Persistent, // sobrevive a un reinicio de RabbitMQ
			MessageId:     m.ID,
			Type:          m.Type,
			CorrelationId: m.CorrelationID,
			Timestamp:     time.Now(),
			Body:          m.Body,
		})
	if err != nil {
		p.close()
		return fmt.Errorf("publish: %w", err)
	}

	ok, err := confirm.WaitContext(ctx)
	if err != nil {
		p.close()
		return fmt.Errorf("wait for broker confirmation: %w", err)
	}
	if !ok {
		return errors.New("broker rejected the message")
	}
	return nil
}

// Close cierra la conexión (se usa al apagar).
func (p *Publisher) Close() {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.close()
}

// connect abre conexión y canal si no hay uno abierto.
func (p *Publisher) connect() error {
	if p.ch != nil && !p.ch.IsClosed() {
		return nil
	}
	p.close()

	conn, err := Dial(p.url)
	if err != nil {
		return err
	}
	ch, err := conn.Channel()
	if err == nil {
		err = ch.Confirm(false) // activa publisher confirms
	}
	if err == nil {
		err = DeclareTopology(ch)
	}
	if err != nil {
		_ = conn.Close()
		return fmt.Errorf("prepare rabbitmq channel: %w", err)
	}
	p.conn, p.ch = conn, ch
	return nil
}

func (p *Publisher) close() {
	if p.conn != nil {
		// Con plazo: si el broker no responde no queremos quedar colgados.
		_ = p.conn.CloseDeadline(time.Now().Add(2 * time.Second))
	}
	p.conn, p.ch = nil, nil
}
