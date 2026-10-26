// Package logging configures structured application logging.
package logging

import "go.uber.org/zap"

// New creates a structured JSON logger suitable for container log collection.
func New(environment string) (*zap.Logger, error) {
	return NewWithFile(environment, "")
}

// NewWithFile optionally duplicates JSON logs to an operator-managed file.
// The parent directory must exist; operators must configure external log rotation.
func NewWithFile(environment, path string) (*zap.Logger, error) {
	cfg := zap.NewProductionConfig()
	// Stack traces are not needed for collector correlation and can expose paths.
	cfg.DisableStacktrace = true
	cfg.OutputPaths = []string{"stdout"}
	if environment != "production" {
		cfg.Level = zap.NewAtomicLevelAt(zap.DebugLevel)
	}
	if path != "" {
		cfg.OutputPaths = append(cfg.OutputPaths, path)
	}
	return cfg.Build()
}
