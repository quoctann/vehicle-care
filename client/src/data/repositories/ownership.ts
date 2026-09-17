import { db } from '../db'

export async function assertVehicleOwned(accountId: string, vehicleId: string): Promise<void> {
  const vehicle = await db.vehicles.get(vehicleId)
  if (!vehicle || vehicle.accountId !== accountId || vehicle.deletedAt != null) {
    throw new Error('Vehicle does not belong to the current account.')
  }
}
