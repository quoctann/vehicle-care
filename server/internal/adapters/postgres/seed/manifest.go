package seed

type PartTypeSeed struct {
	Code         string
	Name         string
	DisplayOrder int
}

var Manifest = []PartTypeSeed{
	{Code: "engine_oil", Name: "Dầu nhớt", DisplayOrder: 1},
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
