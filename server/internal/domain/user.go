package domain

import "time"

// Account is an authenticated user account.
type Account struct {
	ID            string  `json:"id"`
	Email         string  `json:"email"`
	Name          *string `json:"name"`
	Timezone      string  `json:"timezone"`
	EmailVerified bool    `json:"email_verified"`
	PasswordHash  []byte  `json:"-"`
	AuthVersion   int64   `json:"-"`
}

// Session is an opaque server-side login session.
type Session struct {
	AuthVersion int64
	AccountID   string
	CSRFToken   string
	ExpiresAt   time.Time
}
