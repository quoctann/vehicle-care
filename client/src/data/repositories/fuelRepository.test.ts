import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/data/db'
import { clearAllTables } from '@/data/testUtils'
import { addFuelLog } from './fuelRepository'

afterEach(clearAllTables)

const VEHICLE_ID = 'veh-1'

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
})

describe('fuelRepository.addFuelLog', () => {
  it('không nhập KM: chỉ tạo FuelLog, không tạo OdometerLog', async () => {
    const { fuelLog, odometerLog } = await addFuelLog({
      accountId: 'acc-1',
      vehicleId: VEHICLE_ID,
      liters: 3.2,
      costVnd: 85000,
      shop: null,
      note: null,
      odometerKm: null,
      isFullTank: false,
    })

    expect(odometerLog).toBeNull()
    expect(fuelLog.odometerLogId).toBeNull()
    expect(await db.odometerLogs.where('vehicleId').equals(VEHICLE_ID).count()).toBe(0)
    const outboxRows = await db.outbox.toArray()
    expect(outboxRows).toHaveLength(1)
    expect(outboxRows[0].entityType).toBe('fuel_log')
  })

  it('có nhập KM: tạo FuelLog + OdometerLog ATOMIC, liên kết đúng odometerLogId, 2 outbox mutation', async () => {
    const { fuelLog, odometerLog } = await addFuelLog({
      accountId: 'acc-1',
      vehicleId: VEHICLE_ID,
      liters: 3.2,
      costVnd: 85000,
      shop: 'Cây xăng A',
      note: null,
      odometerKm: 42180,
      isFullTank: true,
    })

    expect(odometerLog).not.toBeNull()
    expect(fuelLog.odometerLogId).toBe(odometerLog!.id)
    expect(odometerLog!.source).toBe('fuel')

    const storedOdometer = await db.odometerLogs.get(odometerLog!.id)
    expect(storedOdometer?.odometerKm).toBe(42180)

    const outboxRows = await db.outbox.toArray()
    expect(outboxRows.map((r) => r.entityType).sort()).toEqual(['fuel_log', 'odometer_log'])
  })

  it('từ chối odometer âm', async () => {
    await expect(
      addFuelLog({
        accountId: 'acc-1',
        vehicleId: VEHICLE_ID,
        liters: null,
        costVnd: null,
        shop: null,
        note: null,
        odometerKm: -10,
        isFullTank: false,
      }),
    ).rejects.toThrow()
  })
})
