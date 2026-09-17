import type { Vehicle } from '@/domain/types'
import { db } from '../db'

export async function getVehicle(accountId: string, id: string): Promise<Vehicle | undefined> {
  const vehicle = await db.vehicles.get(id)
  return vehicle?.accountId === accountId && vehicle.deletedAt == null ? vehicle : undefined
}

export async function listVehicles(accountId: string, opts: { includeArchived?: boolean } = {}): Promise<Vehicle[]> {
  const all = await db.vehicles.where('accountId').equals(accountId).toArray()
  return all
    .filter((v) => v.deletedAt == null)
    .filter((v) => opts.includeArchived || v.archivedAt == null)
    .sort((a, b) => a.createdAtClient.localeCompare(b.createdAtClient))
}
