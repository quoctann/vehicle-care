import { afterEach, describe, expect, it } from 'vitest'
import { db } from '@/data/db'
import { clearAllTables } from '@/data/testUtils'
import { archiveVehicle, createVehicle, deleteVehicle, restoreVehicle, updateVehicle } from './vehicleRepository'

afterEach(clearAllTables)

describe('vehicleRepository', () => {
  it('createVehicle ghi entity + đúng 1 outbox mutation create', async () => {
    const vehicle = await createVehicle({ accountId: 'acc-1', name: 'Honda Wave', plateNumber: '59-X1 123.45' })

    const stored = await db.vehicles.get(vehicle.id)
    expect(stored).toMatchObject({ name: 'Honda Wave', plateNumber: '59-X1 123.45', archivedAt: null, deletedAt: null })

    const outboxRows = await db.outbox.where('entityId').equals(vehicle.id).toArray()
    expect(outboxRows).toHaveLength(1)
    expect(outboxRows[0]).toMatchObject({
      entityType: 'vehicle',
      operation: 'create',
      status: 'pending',
      payload: { name: 'Honda Wave', plate_number: '59-X1 123.45', archived_at: null, deleted_at: null },
    })
  })

  it('updateVehicle sửa field và thêm outbox mutation update mới (không xoá mutation cũ)', async () => {
    const vehicle = await createVehicle({ accountId: 'acc-1', name: 'Honda Wave', plateNumber: null })
    await updateVehicle('acc-1', vehicle.id, { name: 'Honda Wave RSX' })

    const stored = await db.vehicles.get(vehicle.id)
    expect(stored?.name).toBe('Honda Wave RSX')

    const outboxRows = await db.outbox.where('entityId').equals(vehicle.id).toArray()
    expect(outboxRows).toHaveLength(2)
    expect(outboxRows.map((r) => r.operation).sort()).toEqual(['create', 'update'])
  })

  it('archiveVehicle set archivedAt, restoreVehicle clear lại — record vẫn tồn tại', async () => {
    const vehicle = await createVehicle({ accountId: 'acc-1', name: 'Yamaha Janus', plateNumber: null })
    await archiveVehicle('acc-1', vehicle.id)
    expect((await db.vehicles.get(vehicle.id))?.archivedAt).not.toBeNull()

    await restoreVehicle('acc-1', vehicle.id)
    expect((await db.vehicles.get(vehicle.id))?.archivedAt).toBeNull()
  })

  it('deleteVehicle là tombstone (set deletedAt), KHÔNG xoá vật lý', async () => {
    const vehicle = await createVehicle({ accountId: 'acc-1', name: 'Honda City', plateNumber: null })
    await deleteVehicle('acc-1', vehicle.id)

    const stored = await db.vehicles.get(vehicle.id)
    expect(stored).toBeDefined()
    expect(stored?.deletedAt).not.toBeNull()
  })

  it('không cho account khác sửa vehicle đang lưu local', async () => {
    const vehicle = await createVehicle({ accountId: 'acc-1', name: 'Honda Wave', plateNumber: null })
    await expect(updateVehicle('acc-2', vehicle.id, { name: 'Stolen edit' })).rejects.toThrow('not found')
    expect((await db.vehicles.get(vehicle.id))?.name).toBe('Honda Wave')
  })
})
