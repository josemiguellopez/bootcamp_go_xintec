package config

import (
	"testing"
	"time"
)

func TestLoadVars_Defaults(t *testing.T) {
	cfg, err := LoadVars()
	if err != nil {
		t.Fatalf("the defaults must be valid: %v", err)
	}
	if cfg.Port != 3200 || cfg.ShutdownTimeout != 20*time.Second {
		t.Errorf("unexpected defaults: %+v", cfg)
	}
}

func TestLoadVars_RejectsInvalidValues(t *testing.T) {
	invalid := map[string]string{
		"ENVIRONMENT":           "staging",
		"SHUTDOWN_TIMEOUT":      "abc",
		"NOTIFIER_FAILURE_RATE": "1.5",
		"WORKER_CONCURRENCY":    "0",
	}
	for key, value := range invalid {
		t.Run(key, func(t *testing.T) {
			t.Setenv(key, value)
			if _, err := LoadVars(); err == nil {
				t.Fatalf("%s=%s should be rejected", key, value)
			}
		})
	}
}
