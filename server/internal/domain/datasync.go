package domain

import "time"

// Sync protocol values are string-backed to preserve the JSON contract. Only
// adapters convert them to/from plain strings at storage boundaries.
type MutationOperation string

const (
	OperationCreate MutationOperation = "create"
	OperationUpdate MutationOperation = "update"
)

type MutationStatus string

const (
	StatusApplied        MutationStatus = "applied"
	StatusDuplicate      MutationStatus = "duplicate"
	StatusRejected       MutationStatus = "rejected"
	StatusRetryableError MutationStatus = "retryable_error"
)

type MutationErrorCode string

const (
	MutationErrorValidation MutationErrorCode = "validation_failed"
	MutationErrorOwnership  MutationErrorCode = "ownership_invalid"
	MutationErrorInternal   MutationErrorCode = "internal_error"
)

// Mutation describes one client-side entity change.
type Mutation struct {
	MutationID string            `json:"mutation_id"`
	EntityType EntityType        `json:"entity_type"`
	Operation  MutationOperation `json:"operation"`
	EntityID   string            `json:"entity_id"`
	Payload    map[string]any    `json:"payload"`
}

// MutationResult is the acknowledgment for one mutation.
type MutationResult struct {
	MutationID     string            `json:"mutation_id"`
	Status         MutationStatus    `json:"status"`
	ServerSeq      *int64            `json:"server_seq,omitempty"`
	ServerSyncedAt *time.Time        `json:"server_synced_at,omitempty"`
	ErrorCode      MutationErrorCode `json:"error_code,omitempty"`
	ErrorMessage   string            `json:"error_message,omitempty"`
	Retryable      *bool             `json:"retryable,omitempty"`
}

// Change is an immutable changefeed event returned during pull.
type Change struct {
	ServerSeq      int64             `json:"server_seq"`
	EntityType     EntityType        `json:"entity_type"`
	EntityID       string            `json:"entity_id"`
	Operation      MutationOperation `json:"operation"`
	Payload        map[string]any    `json:"payload"`
	ServerSyncedAt time.Time         `json:"server_synced_at"`
}

// PullPage is one bounded page from the changefeed.
type PullPage struct {
	Changes    []Change
	NextCursor int64
	UntilSeq   int64
	HasMore    bool
}
