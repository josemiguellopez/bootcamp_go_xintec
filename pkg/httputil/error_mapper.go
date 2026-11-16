// Package httputil traduce errores a respuestas HTTP con un formato único (RF-05).
package httputil

import (
	"context"
	"errors"
	"net/http"
	"time"

	"microservice/pkg/apperrors"
	"microservice/pkg/logger"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

// ErrorResponse es el cuerpo de todas las respuestas de error.
type ErrorResponse struct {
	Error     ErrorDetail `json:"error"`
	RequestID string      `json:"request_id,omitempty"`
	Timestamp string      `json:"timestamp"`
}

type ErrorDetail struct {
	Type    string `json:"type"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

// MapError decide el código HTTP y el cuerpo. Solo los DomainError muestran
// su mensaje; cualquier otro error (BD, red...) se responde con un mensaje
// genérico para no filtrar detalles internos.
func MapError(err error) (int, ErrorDetail) {
	if de, ok := apperrors.As(err); ok {
		status := map[apperrors.ErrorType]int{
			apperrors.ErrorTypeValidation:      http.StatusBadRequest,
			apperrors.ErrorTypeNotFound:        http.StatusNotFound,
			apperrors.ErrorTypeConflict:        http.StatusConflict,
			apperrors.ErrorTypePayloadTooLarge: http.StatusRequestEntityTooLarge,
		}[de.Type]
		return status, ErrorDetail{Type: string(de.Type), Code: de.Code, Message: de.Message}
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return http.StatusServiceUnavailable, ErrorDetail{
			Type: "SERVICE_UNAVAILABLE", Code: "TIMEOUT", Message: "The request took too long, please retry",
		}
	}
	return http.StatusInternalServerError, ErrorDetail{
		Type: "INTERNAL_ERROR", Code: "INTERNAL_ERROR", Message: "Internal server error",
	}
}

// RespondError responde el error al cliente. El detalle real solo va al log,
// junto con el request_id para poder encontrarlo.
func RespondError(c *gin.Context, err error) {
	status, detail := MapError(err)

	log := logger.FromContext(c.Request.Context())
	if status >= 500 {
		log.Error("request failed", zap.Int("status", status), zap.Error(err))
	} else {
		log.Info("request rejected", zap.Int("status", status), zap.String("code", detail.Code))
	}
	Abort(c, status, detail)
}

// Abort escribe una respuesta de error con el formato común.
func Abort(c *gin.Context, status int, detail ErrorDetail) {
	c.AbortWithStatusJSON(status, ErrorResponse{
		Error:     detail,
		RequestID: c.Writer.Header().Get("X-Request-ID"),
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	})
}
