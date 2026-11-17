package events

import (
	"encoding/json"
	"testing"
	"time"
)

func TestDecodeOrderCreated(t *testing.T) {
	valid, _ := json.Marshal(OrderCreated{
		EventID: "0d4b5c0e-4d3a-4a43-8f1e-2b8a6f7c9d10", EventType: TypeOrderCreated, OccurredAt: time.Now(),
		OrderID: "6b2f7f53-6a8e-4e0f-9b43-6a1f1d1f6c11", CustomerID: "12345678-5", Total: 10,
	})
	e, err := DecodeOrderCreated(valid)
	if err != nil || e.OrderID != "6b2f7f53-6a8e-4e0f-9b43-6a1f1d1f6c11" {
		t.Fatalf("valid event: %+v %v", e, err)
	}

	invalid := map[string]string{
		"not json":     `{`,
		"wrong type":   `{"event_id":"0d4b5c0e-4d3a-4a43-8f1e-2b8a6f7c9d10","event_type":"order.deleted","order_id":"6b2f7f53-6a8e-4e0f-9b43-6a1f1d1f6c11"}`,
		"bad event id": `{"event_id":"x","event_type":"order.created","order_id":"6b2f7f53-6a8e-4e0f-9b43-6a1f1d1f6c11"}`,
		"bad order id": `{"event_id":"0d4b5c0e-4d3a-4a43-8f1e-2b8a6f7c9d10","event_type":"order.created","order_id":"x"}`,
	}
	for name, body := range invalid {
		if _, err := DecodeOrderCreated([]byte(body)); err == nil {
			t.Errorf("%s: expected an error", name)
		}
	}
}
