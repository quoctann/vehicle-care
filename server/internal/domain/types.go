// Package domain contains the application data model without transport or storage dependencies.
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
}

// Session is an opaque server-side login session.
type Session struct {
	AccountID string
	CSRFToken string
	ExpiresAt time.Time
}

// Mutation describes one client-side entity change.
type Mutation struct {
	MutationID    string         `json:"mutation_id"`
	EntityType    string         `json:"entity_type"`
	Operation     string         `json:"operation"`
	EntityID      string         `json:"entity_id"`
	Payload       map[string]any `json:"payload"`
	BaseServerSeq *int64         `json:"base_server_seq,omitempty"`
}

// MutationResult is the acknowledgment for one mutation.
type MutationResult struct {
	MutationID       string         `json:"mutation_id"`
	Status           string         `json:"status"`
	ServerSeq        *int64         `json:"server_seq,omitempty"`
	ReceivedAtServer *time.Time     `json:"received_at_server,omitempty"`
	ErrorCode        string         `json:"error_code,omitempty"`
	ErrorMessage     string         `json:"error_message,omitempty"`
	Retryable        *bool          `json:"retryable,omitempty"`
	ServerSnapshot   map[string]any `json:"server_snapshot,omitempty"`
}

// Change is an immutable changefeed event returned during pull.
type Change struct {
	ServerSeq        int64          `json:"server_seq"`
	EntityType       string         `json:"entity_type"`
	EntityID         string         `json:"entity_id"`
	Operation        string         `json:"operation"`
	Payload          map[string]any `json:"payload"`
	ReceivedAtServer time.Time      `json:"received_at_server"`
}

// PullPage is one stable-watermark page from the changefeed.
type PullPage struct {
	Changes    []Change
	NextCursor int64
	Watermark  string
	HasMore    bool
}

// PartType is one entry of the vehicle-part catalog: either a fixed global
// row (AccountID nil, server manifest is the single source of truth for its
// ID — see .docs/20260919-feedback.md #1) or a custom row an account created
// itself (Feature #2), mutable through the same sync/push pipeline as
// Vehicle.
type PartType struct {
	ID           string `json:"id"`
	Code         string `json:"code"`
	NameVI       string `json:"name_vi"`
	DisplayOrder int32  `json:"display_order"`
	Active       bool   `json:"active"`
	SeedVersion  string `json:"seed_version"`
	// AccountID is nil for the fixed global catalog, set for a custom
	// part_type a specific account created (feedback Feature #2).
	AccountID *string `json:"account_id"`
}
