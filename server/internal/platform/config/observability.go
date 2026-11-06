package config

import (
	"fmt"
	"math"
	"strings"
	"unicode"
)

// Observability is opt-in. Export endpoints, headers and TLS use the standard
// OTEL_EXPORTER_OTLP_* environment variables, read by the OTLP/HTTP exporters.
type Observability struct {
	Enabled          bool    `env:"OTEL_ENABLED" envDefault:"false"`
	ServiceName      string  `env:"OTEL_SERVICE_NAME" envDefault:"vehicle-care-api"`
	TraceSampleRatio float64 `env:"OTEL_TRACE_SAMPLE_RATIO" envDefault:"0.1"`
	Environment      string  `env:"APP_ENV" envDefault:"development"`
	Version          string  `env:"SERVICE_VERSION"`
}

func (c Observability) Validate() error {
	if math.IsNaN(c.TraceSampleRatio) || math.IsInf(c.TraceSampleRatio, 0) || c.TraceSampleRatio < 0 || c.TraceSampleRatio > 1 {
		return fmt.Errorf("OTEL_TRACE_SAMPLE_RATIO must be between 0 and 1")
	}
	if strings.TrimSpace(c.ServiceName) == "" || len(c.ServiceName) > 128 || strings.ContainsFunc(c.ServiceName, unicode.IsControl) {
		return fmt.Errorf("OTEL_SERVICE_NAME must be a nonempty name without control characters (max 128 bytes)")
	}
	return nil
}
