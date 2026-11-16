package retry

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestBackoff_DoublesUpToMax(t *testing.T) {
	p := Policy{InitialBackoff: 100 * time.Millisecond, MaxBackoff: time.Second}
	want := []time.Duration{100, 200, 400, 800, 1000, 1000}
	for i, w := range want {
		if got := p.Backoff(i + 1); got != w*time.Millisecond {
			t.Errorf("Backoff(%d) = %v, want %v", i+1, got, w*time.Millisecond)
		}
	}
}

var fast = Policy{MaxAttempts: 4, InitialBackoff: time.Millisecond, MaxBackoff: 2 * time.Millisecond}

func TestDo_SucceedsAfterTransientFailures(t *testing.T) {
	calls, retries := 0, 0
	attempts, err := Do(context.Background(), fast, func() error {
		calls++
		if calls < 3 {
			return errors.New("transient")
		}
		return nil
	}, func(int, error, time.Duration) { retries++ })

	if err != nil || attempts != 3 || retries != 2 {
		t.Fatalf("attempts=%d retries=%d err=%v; want 3, 2, nil", attempts, retries, err)
	}
}

func TestDo_StopsAfterMaxAttempts(t *testing.T) {
	boom := errors.New("still failing")
	attempts, err := Do(context.Background(), fast, func() error { return boom }, nil)
	if !errors.Is(err, boom) || attempts != 4 {
		t.Fatalf("attempts=%d err=%v; want 4 attempts and the last error", attempts, err)
	}
}

func TestDo_PermanentErrorIsNotRetried(t *testing.T) {
	calls := 0
	_, err := Do(context.Background(), fast, func() error { calls++; return Permanent(errors.New("bad message")) }, nil)
	if calls != 1 || !IsPermanent(err) {
		t.Fatalf("calls=%d permanent=%v; want 1 call and a permanent error", calls, IsPermanent(err))
	}
}

func TestDo_ShutdownStopsRetrying(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	slow := Policy{MaxAttempts: 5, InitialBackoff: time.Hour, MaxBackoff: time.Hour}
	calls := 0
	_, err := Do(ctx, slow, func() error {
		calls++
		cancel() // llega SIGTERM durante el primer intento
		return errors.New("transient")
	}, nil)
	if !errors.Is(err, ErrAborted) || calls != 1 {
		t.Fatalf("calls=%d err=%v; want 1 call and ErrAborted", calls, err)
	}
}
