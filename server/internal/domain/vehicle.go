package domain

import "time"

// PartType is one entry of an account's maintenance-item catalog: either one
// of the fixed template rows copied into the account at signup (see
// postgres/seed.SeedAccountPartTypes) or a custom row the account added
// itself (feedback Feature #2) — both are fully owned and mutable by that
// account through the same sync/push pipeline as Vehicle.
//
// ServerSeq/ReceivedAtServer are included in GET /part-types (not just
// change-feed rows) so the client can learn the real server_seq for a row it
// bootstraps this way — omitting them here previously made the client treat
// every bootstrapped row as "never seen from server" (server_seq == nil),
// which made push.ts resend any edit as operation "create" instead of
// "update" forever, and "create" requires code == id, which is never true
// for a seeded row (code like "engine_oil", id a random uuid) — so every
// edit to a seeded part_type was silently rejected by the server, forever.
type PartType struct {
	ID               string    `json:"id"`
	Code             string    `json:"code"`
	NameVI           string    `json:"name_vi"`
	DisplayOrder     int32     `json:"display_order"`
	Active           bool      `json:"active"`
	SeedVersion      string    `json:"seed_version"`
	AccountID        string    `json:"account_id"`
	ServerSeq        int64     `json:"server_seq"`
	ReceivedAtServer time.Time `json:"received_at_server"`
}
