import { generateId } from '@/lib/uuid'
import type { Vehicle } from '@/domain/types'
import { db } from '../db'
import { vehicleToPayload } from '../mappers'
import { enqueueMutation } from '../outbox'

export async function createVehicle(input: {
  accountId: string
  name: string
  plateNumber: string | null
}): Promise<Vehicle> {
  const name = input.name.trim()
  const plateNumber = input.plateNumber?.trim() || null
  if (!name || name.length > 80) throw new Error('Vehicle name must contain 1 to 80 characters.')
  if (plateNumber && plateNumber.length > 24) throw new Error('Plate number must contain at most 24 characters.')
  const now = new Date().toISOString()
  const vehicle: Vehicle = {
    id: generateId(),
    accountId: input.accountId,
    name,
    plateNumber,
    archivedAt: null,
    deletedAt: null,
    dueSoonRatio: null,
    createdAtClient: now,
    receivedAtServer: null,
    serverSeq: null,
  }
  await db.transaction('rw', db.vehicles, db.outbox, async () => {
    await db.vehicles.add(vehicle)
    await enqueueMutation({
      entityType: 'vehicle',
      operation: 'create',
      entityId: vehicle.id,
      payload: vehicleToPayload(vehicle),
    })
  })
  return vehicle
}

async function writeVehiclePatch(accountId: string, id: string, patch: Partial<Vehicle>): Promise<void> {
  await db.transaction('rw', db.vehicles, db.outbox, async () => {
    const current = await db.vehicles.get(id)
    if (!current || current.accountId !== accountId) throw new Error(`Vehicle not found: ${id}`)
    const updated: Vehicle = { ...current, ...patch }
    await db.vehicles.put(updated)
    await enqueueMutation({
      entityType: 'vehicle',
      operation: 'update',
      entityId: id,
      payload: vehicleToPayload(updated),
    })
  })
}

export function updateVehicle(accountId: string, id: string, patch: Partial<Pick<Vehicle, 'name' | 'plateNumber'>>): Promise<void> {
  return writeVehiclePatch(accountId, id, patch)
}

/** Sheet "Cài đặt xe" — sửa tên/biển số/ngưỡng cảnh báo cùng lúc (feedback Feature #1). */
export function updateVehicleDetails(
  accountId: string,
  id: string,
  patch: Partial<Pick<Vehicle, 'name' | 'plateNumber' | 'dueSoonRatio'>>,
): Promise<void> {
  return writeVehiclePatch(accountId, id, patch)
}

/** Archive = ẩn có thể khôi phục — KHÁC tombstone (`deleteVehicle`). */
export function archiveVehicle(accountId: string, id: string): Promise<void> {
  return writeVehiclePatch(accountId, id, { archivedAt: new Date().toISOString() })
}

export function restoreVehicle(accountId: string, id: string): Promise<void> {
  return writeVehiclePatch(accountId, id, { archivedAt: null })
}

/** Tombstone — không xóa vật lý (3.5 decision.md). */
export function deleteVehicle(accountId: string, id: string): Promise<void> {
  return writeVehiclePatch(accountId, id, { deletedAt: new Date().toISOString() })
}
