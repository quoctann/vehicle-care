package domain

import "time"

// Mutation describes one client-side entity change.
type Mutation struct {
	MutationID string         `json:"mutation_id"`
	EntityType string         `json:"entity_type"`
	Operation  string         `json:"operation"`
	EntityID   string         `json:"entity_id"`
	Payload    map[string]any `json:"payload"`
}

// MutationResult is the acknowledgment for one mutation.
type MutationResult struct {
	MutationID     string     `json:"mutation_id"`
	Status         string     `json:"status"`
	ServerSeq      *int64     `json:"server_seq,omitempty"`
	ServerSyncedAt *time.Time `json:"server_synced_at,omitempty"`
	ErrorCode      string     `json:"error_code,omitempty"`
	ErrorMessage   string     `json:"error_message,omitempty"`
	Retryable      *bool      `json:"retryable,omitempty"`
}

// Change is an immutable changefeed event returned during pull.
type Change struct {
	ServerSeq      int64          `json:"server_seq"`
	EntityType     string         `json:"entity_type"`
	EntityID       string         `json:"entity_id"`
	Operation      string         `json:"operation"`
	Payload        map[string]any `json:"payload"`
	ServerSyncedAt time.Time      `json:"server_synced_at"`
}

// PullPage is one bounded page from the changefeed.
type PullPage struct {
	Changes    []Change
	NextCursor int64
	UntilSeq   int64
	HasMore    bool
}
