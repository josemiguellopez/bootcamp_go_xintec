package domain

import (
	"fmt"

	"microservice/pkg/apperrors"
)

// Status es el estado de un pedido. Los valores son los que definió el
// profesor para el desafío.
type Status string

const (
	StatusEnPreparacion     Status = "en_preparacion"      // recién creado
	StatusListoParaDespacho Status = "listo_para_despacho" // lo deja así el worker al procesar el evento
	StatusEnTransito        Status = "en_transito"         // salió a reparto
	StatusEntregado         Status = "entregado"           // el cliente lo recibió
	StatusNoEntregado       Status = "no_entregado"        // el reparto falló (se puede reintentar)
	StatusDevuelto          Status = "devuelto"            // volvió a la tienda
)

// transitions dice a qué estados se puede pasar desde cada estado.
// Todo lo que no está aquí es un salto inválido (HTTP 409).
//
//	en_preparacion ──► listo_para_despacho ──► en_transito ──► entregado ──► devuelto
//	                                              ▲     │
//	                                              │     ▼
//	                                           no_entregado ──► devuelto
var transitions = map[Status][]Status{
	StatusEnPreparacion:     {StatusListoParaDespacho},
	StatusListoParaDespacho: {StatusEnTransito},
	StatusEnTransito:        {StatusEntregado, StatusNoEntregado},
	StatusNoEntregado:       {StatusEnTransito, StatusDevuelto},
	StatusEntregado:         {StatusDevuelto},
	StatusDevuelto:          {},
}

// ParseStatus convierte un texto en Status. Devuelve error de validación si
// no es uno de los seis estados.
func ParseStatus(s string) (Status, error) {
	st := Status(s)
	if _, ok := transitions[st]; !ok {
		return "", apperrors.NewValidationError("ORDER_INVALID_STATUS",
			"status must be one of: en_preparacion, listo_para_despacho, en_transito, entregado, no_entregado, devuelto")
	}
	return st, nil
}

// NextStatuses devuelve los estados a los que se puede pasar desde s.
func NextStatuses(s Status) []Status {
	return append([]Status(nil), transitions[s]...)
}

// CanTransition indica si se puede pasar de from a to.
func CanTransition(from, to Status) bool {
	for _, next := range transitions[from] {
		if next == to {
			return true
		}
	}
	return false
}

func errInvalidTransition(from, to Status) error {
	return apperrors.NewConflictError("ORDER_INVALID_TRANSITION",
		fmt.Sprintf("order cannot change from %s to %s", from, to))
}
