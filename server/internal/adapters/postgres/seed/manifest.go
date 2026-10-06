// Package seed defines the fixed part_types template and applies it to a
// new account's own rows.
package seed

// PartTypeSeed is one fixed template entry used to bootstrap a new
// account's part_types rows. Code must never change once shipped — it's
// what carries meaning forward (e.g. icon lookup on the client) across every
// account's copy of this row; the actual database id is minted fresh per
// account (see SeedAccountPartTypes), never taken from this struct.
type PartTypeSeed struct {
	Code         string
	Name         string
	DisplayOrder int
}

// Manifest is the MVP part_types template approved in
// .docs/implementation-plan-section-5.md §7 (workstream C). Adding a new
// entry later means adding a new template code without changing existing
// codes; accounts already created are not automatically reseeded.
var Manifest = []PartTypeSeed{
	{Code: "engine_oil", Name: "Dầu nhớt động cơ", DisplayOrder: 1},
	{Code: "front_tire", Name: "Lốp trước", DisplayOrder: 2},
	{Code: "rear_tire", Name: "Lốp sau", DisplayOrder: 3},
	{Code: "front_brake_pad", Name: "Má phanh trước", DisplayOrder: 4},
	{Code: "rear_brake_pad", Name: "Má phanh sau", DisplayOrder: 5},
	{Code: "spark_plug", Name: "Bugi", DisplayOrder: 6},
	{Code: "air_filter", Name: "Lọc gió", DisplayOrder: 7},
	{Code: "drive_belt", Name: "Dây curoa", DisplayOrder: 8},
	{Code: "chain_sprocket_set", Name: "Nhông, sên, đĩa", DisplayOrder: 9},
	{Code: "battery", Name: "Ắc quy", DisplayOrder: 10},
}
