package domain

import "time"

//MARK: offline-first sync engine

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
	MutationID       string     `json:"mutation_id"`
	Status           string     `json:"status"`
	ServerSeq        *int64     `json:"server_seq,omitempty"`
	ReceivedAtServer *time.Time `json:"received_at_server,omitempty"`
	ErrorCode        string     `json:"error_code,omitempty"`
	ErrorMessage     string     `json:"error_message,omitempty"`
	Retryable        *bool      `json:"retryable,omitempty"`
}

//MARK: change feed

// Change is an immutable changefeed event returned during pull.
type Change struct {
	ServerSeq        int64          `json:"server_seq"`
	EntityType       string         `json:"entity_type"`
	EntityID         string         `json:"entity_id"`
	Operation        string         `json:"operation"`
	Payload          map[string]any `json:"payload"`
	ReceivedAtServer time.Time      `json:"received_at_server"`
}

// PullPage is one bounded page from the changefeed.
type PullPage struct {
	Changes    []Change
	NextCursor int64
	UntilSeq   int64
	HasMore    bool
}
