// Package metrics guarda contadores básicos con expvar (librería estándar,
// sin dependencias extra) y los publica en JSON en GET /metrics.
package metrics

import (
	"expvar"
	"net/http"
)

var counters = expvar.NewMap("eventflow")

const (
	HTTPRequests         = "http_requests_total"
	HTTPServerErrors     = "http_5xx_total"
	OrdersCreated        = "orders_created_total"
	OrdersReplayed       = "orders_idempotent_replays_total"
	EventsPublished      = "events_published_total"
	EventsPublishFailed  = "events_publish_failed_total"
	MessagesProcessed    = "messages_processed_total"
	MessagesRetried      = "messages_retried_total"
	MessagesDeadLettered = "messages_dead_lettered_total"
	MessagesDuplicated   = "messages_duplicated_total"
)

// Inc suma 1 al contador name.
func Inc(name string) { counters.Add(name, 1) }

// Handler responde con todos los contadores en JSON.
func Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(counters.String()))
	})
}
