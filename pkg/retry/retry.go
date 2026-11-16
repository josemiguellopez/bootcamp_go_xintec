// Package retry reintenta una operación con un límite de intentos y una espera
// que se duplica en cada intento (RF-11).
package retry

import (
	"context"
	"errors"
	"time"
)

// Policy: MaxAttempts intentos en total; la espera empieza en InitialBackoff,
// se duplica en cada intento y nunca supera MaxBackoff.
type Policy struct {
	MaxAttempts    int
	InitialBackoff time.Duration
	MaxBackoff     time.Duration
}

// Backoff devuelve la espera después del intento número attempt (1, 2, 3...).
// Ejemplo con 500ms y tope 5s: 500ms, 1s, 2s, 4s, 5s, 5s...
func (p Policy) Backoff(attempt int) time.Duration {
	d := p.InitialBackoff
	for i := 1; i < attempt; i++ {
		d *= 2
		if d >= p.MaxBackoff {
			return p.MaxBackoff
		}
	}
	return d
}

// permanentError marca errores que no se arreglan reintentando (p. ej. un
// mensaje con JSON inválido).
type permanentError struct{ err error }

func (e permanentError) Error() string { return e.err.Error() }
func (e permanentError) Unwrap() error { return e.err }

// Permanent envuelve err para indicar que no debe reintentarse.
func Permanent(err error) error { return permanentError{err: err} }

// IsPermanent indica si err fue marcado con Permanent.
func IsPermanent(err error) bool {
	var pe permanentError
	return errors.As(err, &pe)
}

// ErrAborted indica que se dejó de reintentar porque ctx se canceló (apagado).
var ErrAborted = errors.New("retry aborted by shutdown")

// Do ejecuta fn hasta que funcione, devuelva un error permanente o se acaben
// los intentos. Devuelve cuántos intentos hizo y el último error.
// Si ctx se cancela durante una espera, no hace más intentos y devuelve ErrAborted.
func Do(ctx context.Context, p Policy, fn func() error, onRetry func(attempt int, err error, wait time.Duration)) (int, error) {
	for attempt := 1; ; attempt++ {
		err := fn()
		if err == nil || IsPermanent(err) || attempt >= p.MaxAttempts {
			return attempt, err
		}

		wait := p.Backoff(attempt)
		if onRetry != nil {
			onRetry(attempt, err, wait)
		}
		select {
		case <-ctx.Done():
			return attempt, errors.Join(ErrAborted, err)
		case <-time.After(wait):
		}
	}
}
