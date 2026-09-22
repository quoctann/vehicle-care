package domain

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
