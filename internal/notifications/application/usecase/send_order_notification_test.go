package usecase

import (
	"context"
	"errors"
	"testing"

	"microservice/internal/notifications/domain"
)

type memRepo struct{ sent map[string]bool }

func (r *memRepo) AlreadySent(_ context.Context, id string) (bool, error) { return r.sent[id], nil }
func (r *memRepo) MarkSent(_ context.Context, id, _ string) error         { r.sent[id] = true; return nil }

type fakeSender struct {
	failures int // cuántas veces fallar antes de funcionar
	emails   int
}

func (s *fakeSender) Send(context.Context, domain.Message) error {
	if s.failures > 0 {
		s.failures--
		return errors.New("provider unavailable")
	}
	s.emails++
	return nil
}

var message = domain.Message{EventID: "evt-1", OrderID: "order-1"}

func TestSend_SendsAndRecords(t *testing.T) {
	repo, sender := &memRepo{sent: map[string]bool{}}, &fakeSender{}
	sent, err := NewSendOrderNotificationUseCase(repo, sender).Execute(context.Background(), message)
	if err != nil || !sent || sender.emails != 1 || !repo.sent["evt-1"] {
		t.Fatalf("sent=%v err=%v emails=%d recorded=%v", sent, err, sender.emails, repo.sent["evt-1"])
	}
}

func TestSend_DuplicateMessageDoesNotSendTwice(t *testing.T) {
	repo, sender := &memRepo{sent: map[string]bool{}}, &fakeSender{}
	uc := NewSendOrderNotificationUseCase(repo, sender)
	_, _ = uc.Execute(context.Background(), message)

	sent, err := uc.Execute(context.Background(), message)
	if err != nil || sent || sender.emails != 1 {
		t.Fatalf("duplicate: sent=%v err=%v emails=%d; want only 1 email", sent, err, sender.emails)
	}
}

func TestSend_ProviderFailureIsNotRecorded(t *testing.T) {
	repo, sender := &memRepo{sent: map[string]bool{}}, &fakeSender{failures: 1}
	uc := NewSendOrderNotificationUseCase(repo, sender)

	if _, err := uc.Execute(context.Background(), message); err == nil {
		t.Fatal("expected the provider error")
	}
	if repo.sent["evt-1"] {
		t.Fatal("a failed send must not be recorded, so the retry sends it")
	}
	if sent, err := uc.Execute(context.Background(), message); err != nil || !sent {
		t.Fatalf("retry should work: sent=%v err=%v", sent, err)
	}
}
