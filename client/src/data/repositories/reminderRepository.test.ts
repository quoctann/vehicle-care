import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/data/db'
import { clearAllTables } from '@/data/testUtils'
import { createReminderConfig, deleteReminderConfig, updateReminderConfig } from './reminderRepository'

afterEach(clearAllTables)

const VEHICLE_ID = 'veh-1'
const PART_TYPE_ID = 'pt-engine-oil'

beforeEach(async () => {
  await db.vehicles.put({
    id: VEHICLE_ID,
    accountId: 'acc-1',
    name: 'Test bike',
    plateNumber: null,
    archivedAt: null,
    deletedAt: null,
    createdAtClient: new Date().toISOString(),
    receivedAtServer: null,
    serverSeq: null,
  })
  await db.partTypes.put({
    id: PART_TYPE_ID,
    code: 'engine_oil',
    displayName: 'Dầu nhớt động cơ',
    displayOrder: 1,
    active: true,
    seedVersion: 1,
  })
})

describe('reminderRepository', () => {
  it('createReminderConfig hợp lệ tạo entity + outbox mutation', async () => {
    const reminder = await createReminderConfig({
      accountId: 'acc-1',
      vehicleId: VEHICLE_ID,
      partTypeId: PART_TYPE_ID,
      intervalKm: 5000,
      intervalDays: null,
      baselineOdometerKm: 38000,
      baselineDate: null,
    })

    expect(await db.reminderConfigs.get(reminder.id)).toMatchObject({ intervalKm: 5000, enabled: true, deletedAt: null })
    const outboxRows = await db.outbox.where('entityId').equals(reminder.id).toArray()
    expect(outboxRows[0]).toMatchObject({ entityType: 'reminder_config', operation: 'create' })
  })

  it('từ chối tạo khi thiếu cả 2 interval (A3)', async () => {
    await expect(
      createReminderConfig({
        accountId: 'acc-1',
        vehicleId: VEHICLE_ID,
        partTypeId: PART_TYPE_ID,
        intervalKm: null,
        intervalDays: null,
        baselineOdometerKm: null,
        baselineDate: null,
      }),
    ).rejects.toThrow()
  })

  it('từ chối tạo trùng (vehicleId, partTypeId) khi bản active đã tồn tại', async () => {
    await createReminderConfig({
      accountId: 'acc-1',
      vehicleId: VEHICLE_ID,
      partTypeId: PART_TYPE_ID,
      intervalKm: 5000,
      intervalDays: null,
      baselineOdometerKm: 0,
      baselineDate: null,
    })

    await expect(
      createReminderConfig({
        accountId: 'acc-1',
        vehicleId: VEHICLE_ID,
        partTypeId: PART_TYPE_ID,
        intervalKm: 6000,
        intervalDays: null,
        baselineOdometerKm: 0,
        baselineDate: null,
      }),
    ).rejects.toThrow()
  })

  it('cho phép tạo lại cùng (vehicleId, partTypeId) SAU KHI bản cũ đã bị tombstone', async () => {
    const first = await createReminderConfig({
      accountId: 'acc-1',
      vehicleId: VEHICLE_ID,
      partTypeId: PART_TYPE_ID,
      intervalKm: 5000,
      intervalDays: null,
      baselineOdometerKm: 0,
      baselineDate: null,
    })
    await deleteReminderConfig('acc-1', first.id)

    const second = await createReminderConfig({
      accountId: 'acc-1',
      vehicleId: VEHICLE_ID,
      partTypeId: PART_TYPE_ID,
      intervalKm: 6000,
      intervalDays: null,
      baselineOdometerKm: 0,
      baselineDate: null,
    })
    expect(second.id).not.toBe(first.id)
  })

  it('updateReminderConfig từ chối nếu patch làm mất cả 2 interval trên reminder chưa tombstone', async () => {
    const reminder = await createReminderConfig({
      accountId: 'acc-1',
      vehicleId: VEHICLE_ID,
      partTypeId: PART_TYPE_ID,
      intervalKm: 5000,
      intervalDays: null,
      baselineOdometerKm: 0,
      baselineDate: null,
    })
    await expect(updateReminderConfig('acc-1', reminder.id, { intervalKm: null })).rejects.toThrow()
  })
})
