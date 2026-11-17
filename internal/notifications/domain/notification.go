// Package domain define la notificación al cliente y sus puertos.
package domain

import "context"

// Message es lo que se le avisa al cliente cuando se crea su pedido.
type Message struct {
	EventID    string // también sirve como clave de idempotencia para el proveedor de email
	OrderID    string
	CustomerID string
	Total      int64 // en pesos chilenos
}

// Sender envía el mensaje por un canal externo (aquí, un email simulado).
// Si devuelve error, se considera transitorio y se reintenta.
type Sender interface {
	Send(ctx context.Context, m Message) error
}

// Repository recuerda qué eventos ya se notificaron, para no avisar dos veces
// si RabbitMQ entrega un mensaje duplicado.
type Repository interface {
	AlreadySent(ctx context.Context, eventID string) (bool, error)
	MarkSent(ctx context.Context, eventID, orderID string) error
}
