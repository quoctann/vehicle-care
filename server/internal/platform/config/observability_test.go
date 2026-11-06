package config

import (
	"github.com/caarlos0/env/v11"
	"math"
	"testing"
)

func TestObservabilityDefaultsAndValidation(t *testing.T) {
	var cfg Observability
	if err := env.ParseWithOptions(&cfg, env.Options{Environment: map[string]string{}}); err != nil {
		t.Fatal(err)
	}
	if cfg.Enabled || cfg.ServiceName != "vehicle-care-api" || cfg.TraceSampleRatio != 0.1 {
		t.Fatalf("unexpected defaults: %+v", cfg)
	}
	if err := cfg.Validate(); err != nil {
		t.Fatal(err)
	}
	for _, ratio := range []float64{-1, 1.01, math.NaN(), math.Inf(1)} {
		invalid := cfg
		invalid.TraceSampleRatio = ratio
		if invalid.Validate() == nil {
			t.Errorf("accepted ratio %v", ratio)
		}
	}
	for _, name := range []string{"", " ", "unsafe\nservice"} {
		invalid := cfg
		invalid.ServiceName = name
		if invalid.Validate() == nil {
			t.Errorf("accepted name %q", name)
		}
	}
	for _, ratio := range []float64{0, 1} {
		valid := cfg
		valid.TraceSampleRatio = ratio
		if err := valid.Validate(); err != nil {
			t.Fatal(err)
		}
	}
}
