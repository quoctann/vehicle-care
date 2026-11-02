package application

import "errors"

// Application Error Codes
const (
	ErrAuthInvalid      = "auth_invalid"
	ErrSessionExpired   = "session_expired"
	ErrOwnershipInvalid = "ownership_invalid"
	ErrConflict         = "conflict"
	ErrInternalError    = "internal_error"
	ErrValidationFailed = "validation_failed"
	ErrRateLimited      = "rate_limited"
)

// Error identifies an application failure that the HTTP adapter can map safely.
type Error struct {
	Code    string
	Message string
}

func (e *Error) Error() string { return e.Message }

func AsError(err error) (*Error, bool) {
	var appErr *Error
	if !errors.As(err, &appErr) {
		return nil, false
	}
	return appErr, true
}
