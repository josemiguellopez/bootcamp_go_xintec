// Package apperrors define errores de negocio tipados. No sabe nada de HTTP:
// la traducción a códigos de estado está en pkg/httputil.
package apperrors

import (
	"errors"
	"fmt"
)

type ErrorType string

const (
	ErrorTypeValidation      ErrorType = "VALIDATION_ERROR"  // -> 400
	ErrorTypeNotFound        ErrorType = "NOT_FOUND"         // -> 404
	ErrorTypeConflict        ErrorType = "CONFLICT"          // -> 409
	ErrorTypePayloadTooLarge ErrorType = "PAYLOAD_TOO_LARGE" // -> 413
)

// DomainError es un error esperado del negocio. Su Message se puede mostrar
// al cliente, así que nunca debe contener SQL, contraseñas ni datos internos.
type DomainError struct {
	Type    ErrorType
	Code    string
	Message string
}

func (e *DomainError) Error() string {
	return fmt.Sprintf("[%s] %s: %s", e.Type, e.Code, e.Message)
}

func NewValidationError(code, message string) *DomainError {
	return &DomainError{Type: ErrorTypeValidation, Code: code, Message: message}
}

func NewNotFoundError(code, message string) *DomainError {
	return &DomainError{Type: ErrorTypeNotFound, Code: code, Message: message}
}

func NewConflictError(code, message string) *DomainError {
	return &DomainError{Type: ErrorTypeConflict, Code: code, Message: message}
}

func NewPayloadTooLargeError(code, message string) *DomainError {
	return &DomainError{Type: ErrorTypePayloadTooLarge, Code: code, Message: message}
}

// As obtiene el *DomainError aunque esté envuelto con fmt.Errorf("...: %w", err).
func As(err error) (*DomainError, bool) {
	var de *DomainError
	ok := errors.As(err, &de)
	return de, ok
}

// HasCode indica si err es un DomainError con ese código.
func HasCode(err error, code string) bool {
	de, ok := As(err)
	return ok && de.Code == code
}
