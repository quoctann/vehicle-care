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
	NameVI       string
	DisplayOrder int
	SeedVersion  string
}

// Manifest is the MVP part_types template approved in
// .docs/implementation-plan-section-5.md §7 (workstream C). Adding a new
// entry later means appending a new row with a bumped SeedVersion, never
// editing an existing row's Code.
var Manifest = []PartTypeSeed{
	{Code: "engine_oil", NameVI: "Dầu nhớt động cơ", DisplayOrder: 1, SeedVersion: "v1"},
	{Code: "front_tire", NameVI: "Lốp trước", DisplayOrder: 2, SeedVersion: "v1"},
	{Code: "rear_tire", NameVI: "Lốp sau", DisplayOrder: 3, SeedVersion: "v1"},
	{Code: "front_brake_pad", NameVI: "Má phanh trước", DisplayOrder: 4, SeedVersion: "v1"},
	{Code: "rear_brake_pad", NameVI: "Má phanh sau", DisplayOrder: 5, SeedVersion: "v1"},
	{Code: "spark_plug", NameVI: "Bugi", DisplayOrder: 6, SeedVersion: "v1"},
	{Code: "air_filter", NameVI: "Lọc gió", DisplayOrder: 7, SeedVersion: "v1"},
	{Code: "drive_belt", NameVI: "Dây curoa", DisplayOrder: 8, SeedVersion: "v1"},
	{Code: "chain_sprocket_set", NameVI: "Nhông, sên, đĩa", DisplayOrder: 9, SeedVersion: "v1"},
	{Code: "battery", NameVI: "Ắc quy", DisplayOrder: 10, SeedVersion: "v1"},
}
