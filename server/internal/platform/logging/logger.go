// Package logging configures structured application logging.
package logging

import "go.uber.org/zap"

// New creates a development or production Zap logger.
func New(environment string) (*zap.Logger, error) {
	if environment == "production" {
		return zap.NewProduction()
	}
	return zap.NewDevelopment()
}
