// Package correlation guarda en el context.Context el id que permite seguir
// una petición desde el POST hasta el worker.
package correlation

import (
	"context"
	"regexp"

	"github.com/google/uuid"
)

type ctxKey struct{}

// Solo aceptamos ids cortos y con caracteres seguros (evita inyectar texto en los logs).
var validID = regexp.MustCompile(`^[A-Za-z0-9._-]{1,64}$`)

func WithID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, ctxKey{}, id)
}

// ID devuelve el id guardado en ctx ("" si no hay).
func ID(ctx context.Context) string {
	id, _ := ctx.Value(ctxKey{}).(string)
	return id
}

// Sanitize devuelve candidate si es un id válido; si no, genera uno nuevo.
func Sanitize(candidate string) string {
	if validID.MatchString(candidate) {
		return candidate
	}
	return uuid.NewString()
}
