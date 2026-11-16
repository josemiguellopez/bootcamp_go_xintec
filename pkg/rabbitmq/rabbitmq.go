// Package rabbitmq conecta con RabbitMQ: declara colas, publica mensajes y
// los consume con reintentos.
package rabbitmq

import (
	"fmt"
	"time"

	"microservice/pkg/events"

	amqp "github.com/rabbitmq/amqp091-go"
)

// Dial abre una conexión. El error no incluye la URL porque tiene la contraseña.
func Dial(url string) (*amqp.Connection, error) {
	conn, err := amqp.DialConfig(url, amqp.Config{Dial: amqp.DefaultDial(5 * time.Second)})
	if err != nil {
		return nil, fmt.Errorf("connect to rabbitmq: %w", err)
	}
	return conn, nil
}

// DeclareTopology crea (si no existen) el exchange, las colas y sus colas de
// mensajes muertos. Declarar algo que ya existe no hace nada, así que la API
// y el worker pueden llamarla sin coordinarse.
//
//	eventflow.events --order.created--> orders.processing  --(rechazado)--> eventflow.dlx --> orders.processing.dlq
//	                 --order.created--> notifications.send --(rechazado)--> eventflow.dlx --> notifications.send.dlq
func DeclareTopology(ch *amqp.Channel) error {
	if err := ch.ExchangeDeclare(events.Exchange, "topic", true, false, false, false, nil); err != nil {
		return fmt.Errorf("declare exchange: %w", err)
	}
	if err := ch.ExchangeDeclare(events.DeadLetterExchange, "direct", true, false, false, false, nil); err != nil {
		return fmt.Errorf("declare dead-letter exchange: %w", err)
	}

	for _, queue := range events.Queues {
		dlq := queue + ".dlq"
		if _, err := ch.QueueDeclare(dlq, true, false, false, false, nil); err != nil {
			return fmt.Errorf("declare %s: %w", dlq, err)
		}
		if err := ch.QueueBind(dlq, queue, events.DeadLetterExchange, false, nil); err != nil {
			return fmt.Errorf("bind %s: %w", dlq, err)
		}

		// Cuando un mensaje de esta cola se rechaza sin reencolar, RabbitMQ
		// lo envía al dead-letter exchange y termina en la .dlq.
		args := amqp.Table{
			"x-dead-letter-exchange":    events.DeadLetterExchange,
			"x-dead-letter-routing-key": queue,
		}
		if _, err := ch.QueueDeclare(queue, true, false, false, false, args); err != nil {
			return fmt.Errorf("declare %s: %w", queue, err)
		}
		if err := ch.QueueBind(queue, events.TypeOrderCreated, events.Exchange, false, nil); err != nil {
			return fmt.Errorf("bind %s: %w", queue, err)
		}
	}
	return nil
}
