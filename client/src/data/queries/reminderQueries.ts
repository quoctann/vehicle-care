import { calculateReminderStatus } from '@/domain/reminder'
import { deriveCurrentOdometer } from '@/domain/odometer'
import type { IanaTimezone, IsoDateTime, PartType, ReminderCalculationResult, ReminderConfig } from '@/domain/types'
import { db } from '../db'

export type ReminderWithStatus = {
  config: ReminderConfig
  partType: PartType
  result: ReminderCalculationResult
}

export async function getCurrentOdometer(accountId: string, vehicleId: string): Promise<number | null> {
  const vehicle = await db.vehicles.get(vehicleId)
  if (!vehicle || vehicle.accountId !== accountId || vehicle.deletedAt != null) return null
  const logs = (await db.odometerLogs.where('vehicleId').equals(vehicleId).toArray()).filter((log) => log.accountId === accountId)
  return deriveCurrentOdometer(logs)
}

/**
 * Danh sách reminder ĐANG HOẠT ĐỘNG (enabled, chưa tombstone) của 1 xe, kèm kết
 * quả tính toán domain (`calculateReminderStatus`) — dùng thẳng cho Home page
 * (Overdue/Due soon) và Settings (danh sách reminder theo xe, khi cần).
 */
export async function listReminderStatusesForVehicle(
  accountId: string,
  vehicleId: string,
  accountTimezone: IanaTimezone,
  now: IsoDateTime = new Date().toISOString(),
  includeDisabled = false,
): Promise<ReminderWithStatus[]> {
  const [configs, partTypes, currentOdometerKm] = await Promise.all([
    db.reminderConfigs.where('vehicleId').equals(vehicleId).and((config) => config.accountId === accountId).toArray(),
    db.partTypes.toArray(),
    getCurrentOdometer(accountId, vehicleId),
  ])

  const activeConfigs = configs.filter((c) => c.deletedAt == null && (includeDisabled || c.enabled))
  const partTypeById = new Map(partTypes.map((p) => [p.id, p]))

  const results = await Promise.all(
    activeConfigs.map(async (config): Promise<ReminderWithStatus | null> => {
      const partType = partTypeById.get(config.partTypeId)
      if (!partType) return null // PartType chưa sync xong hoặc dữ liệu chưa nhất quán — bỏ qua thay vì crash

      const serviceLogs = await db.serviceLogs
        .where('vehicleId')
        .equals(vehicleId)
        .and((l) => l.accountId === accountId && l.partTypeId === config.partTypeId)
        .toArray()
      const lastServiceLog =
        serviceLogs.length > 0 ? serviceLogs.reduce((a, b) => (b.servicedAt > a.servicedAt ? b : a)) : null

      const result = calculateReminderStatus({
        config,
        currentOdometerKm,
        lastServiceLog: lastServiceLog
          ? { odometerKmSnapshot: lastServiceLog.odometerKmSnapshot, servicedAt: lastServiceLog.servicedAt }
          : null,
        now,
        accountTimezone,
      })
      return { config, partType, result }
    }),
  )

  return results.filter((r): r is ReminderWithStatus => r !== null)
}
