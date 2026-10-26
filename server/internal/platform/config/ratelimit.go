package config

import "fmt"

// ValidateRateLimit bounds Lua arithmetic and rejects accidentally disabled
// protection. Zero is not a disable switch in environment configuration.
func (c Config) ValidateRateLimit() error {
	if c.APIRateLimitPerMinute <= 0 || c.APIRateLimitPerMinute > 1_000_000 {
		return fmt.Errorf("API_RATE_LIMIT_PER_MINUTE must be between 1 and 1000000")
	}
	if c.APIRateLimitBurst <= 0 || c.APIRateLimitBurst > 1_000_000 {
		return fmt.Errorf("API_RATE_LIMIT_BURST must be between 1 and 1000000")
	}
	return nil
}
