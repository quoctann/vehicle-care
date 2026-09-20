import { afterEach, describe, expect, it } from 'vitest'
import { db } from '@/data/db'
import { createReminderConfig } from '@/data/repositories/reminderRepository'
import { clearAllTables } from '@/data/testUtils'
import { getCurrentOdometer, listReminderStatusesForVehicle } from './reminderQueries'

afterEach(clearAllTables)

const VEHICLE_ID = 'veh-1'
const PART_TYPE_ID = 'pt-engine-oil'
const ACCOUNT_ID = 'acc-1'

async function seedVehicle() {
  await db.vehicles.put({
    id: VEHICLE_ID,
    accountId: ACCOUNT_ID,
    name: 'Test bike',
    plateNumber: null,
    archivedAt: null,
    deletedAt: null,
    dueSoonRatio: null,
    createdAtClient: '2026-01-01T00:00:00.000Z',
    receivedAtServer: null,
    serverSeq: null,
  })
}

async function seedPartType() {
  await db.partTypes.put({
    id: PART_TYPE_ID,
    code: 'engine_oil',
    displayName: 'Dầu nhớt động cơ',
    displayOrder: 1,
    active: true,
    seedVersion: 1,
    accountId: null,
    createdAtClient: '2026-01-01T00:00:00.000Z',
    receivedAtServer: null,
    serverSeq: null,
  })
}

describe('getCurrentOdometer', () => {
  it('null khi chưa có OdometerLog nào', async () => {
    await seedVehicle()
    expect(await getCurrentOdometer(ACCOUNT_ID, VEHICLE_ID)).toBeNull()
  })

  it('trả về log recordedAt mới nhất', async () => {
    await seedVehicle()
    await db.odometerLogs.bulkAdd([
      {
        id: 'o1',
        accountId: 'acc-1',
        vehicleId: VEHICLE_ID,
        odometerKm: 100,
        recordedAt: '2026-01-01T00:00:00.000Z',
        note: null,
        source: 'manual',
        createdAtClient: '2026-01-01T00:00:00.000Z',
        receivedAtServer: null,
        serverSeq: null,
      },
      {
        id: 'o2',
        accountId: 'acc-1',
        vehicleId: VEHICLE_ID,
        odometerKm: 250,
        recordedAt: '2026-02-01T00:00:00.000Z',
        note: null,
        source: 'manual',
        createdAtClient: '2026-02-01T00:00:00.000Z',
        receivedAtServer: null,
        serverSeq: null,
      },
    ])
    expect(await getCurrentOdometer(ACCOUNT_ID, VEHICLE_ID)).toBe(250)
  })
})

describe('listReminderStatusesForVehicle', () => {
  it('kết hợp ReminderConfig + PartType + odometer hiện tại ra đúng domain status', async () => {
    await seedPartType()
    await seedVehicle()
    await createReminderConfig({
      accountId: 'acc-1',
      vehicleId: VEHICLE_ID,
      partTypeId: PART_TYPE_ID,
      intervalKm: 1000,
      intervalDays: null,
      baselineOdometerKm: 0,
      baselineDate: null,
    })
    await db.odometerLogs.add({
      id: 'o1',
      accountId: 'acc-1',
      vehicleId: VEHICLE_ID,
      odometerKm: 950,
      recordedAt: '2026-01-01T00:00:00.000Z',
      note: null,
      source: 'manual',
      createdAtClient: '2026-01-01T00:00:00.000Z',
      receivedAtServer: null,
      serverSeq: null,
    })

    const results = await listReminderStatusesForVehicle(ACCOUNT_ID, VEHICLE_ID, 'Asia/Ho_Chi_Minh', '2026-06-01T00:00:00.000Z')
    expect(results).toHaveLength(1)
    expect(results[0].partType.displayName).toBe('Dầu nhớt động cơ')
    expect(results[0].result.status).toBe('due_soon') // 950/1000 = 0.95 >= 0.9
  })

  it('bỏ qua reminder đã tombstone hoặc disabled', async () => {
    await seedPartType()
    await seedVehicle()
    const reminder = await createReminderConfig({
      accountId: 'acc-1',
      vehicleId: VEHICLE_ID,
      partTypeId: PART_TYPE_ID,
      intervalKm: 1000,
      intervalDays: null,
      baselineOdometerKm: 0,
      baselineDate: null,
    })
    await db.reminderConfigs.update(reminder.id, { enabled: false })

    const results = await listReminderStatusesForVehicle(ACCOUNT_ID, VEHICLE_ID, 'Asia/Ho_Chi_Minh')
    expect(results).toHaveLength(0)
  })
})
