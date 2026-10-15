package domain

// EntityType identifies the supported sync snapshots and their write policy.
type EntityType string

const (
	EntityVehicle        EntityType = "vehicle"
	EntityReminderConfig EntityType = "reminder_config"
	EntityOdometerLog    EntityType = "odometer_log"
	EntityFuelLog        EntityType = "fuel_log"
	EntityServiceLog     EntityType = "service_log"
	EntityPartType       EntityType = "part_type"
)

func (t EntityType) IsMutable() bool {
	switch t {
	case EntityVehicle, EntityReminderConfig, EntityFuelLog, EntityServiceLog, EntityPartType:
		return true
	default:
		return false
	}
}

func (t EntityType) IsSupported() bool {
	return t.IsMutable() || t == EntityOdometerLog
}
