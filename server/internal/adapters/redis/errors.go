package redis

import "fmt"

// wrapErr wraps a backing-store error with a static operation label. op must
// never contain a token, OTP, or other secret value — only fixed strings
// naming the failing step (e.g. "consume token", "get session") are allowed,
// so error messages surfaced to logs never leak plaintext secrets.
func wrapErr(op string, err error) error {
	return fmt.Errorf("redis: %s: %w", op, err)
}
