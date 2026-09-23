import { toCalendarDateInTimezone } from '@/domain/datetime'
import type { IanaTimezone } from '@/domain/types'
import { db } from '../db'

export type MonthlyCost = { month: string; fuelVnd: number; serviceVnd: number; totalVnd: number }

function monthKey(instant: string, timezone: IanaTimezone): string {
  return toCalendarDateInTimezone(instant, timezone).slice(0, 7) // "YYYY-MM"
}

/** Tổng chi phí Fuel/Service theo từng tháng (theo timezone account), sắp tăng dần. */
export async function getMonthlyCosts(accountId: string, vehicleId: string, accountTimezone: IanaTimezone): Promise<MonthlyCost[]> {
  const vehicle = await db.vehicles.get(vehicleId)
  if (!vehicle || vehicle.accountId !== accountId || vehicle.deletedAt != null) return []
  const [fuelLogs, serviceLogs] = await Promise.all([
    db.fuelLogs.where('vehicleId').equals(vehicleId).and((log) => log.accountId === accountId && log.deletedAt == null).toArray(),
    db.serviceLogs.where('vehicleId').equals(vehicleId).and((log) => log.accountId === accountId && log.deletedAt == null).toArray(),
  ])

  const byMonth = new Map<string, MonthlyCost>()
  function ensure(month: string): MonthlyCost {
    let entry = byMonth.get(month)
    if (!entry) {
      entry = { month, fuelVnd: 0, serviceVnd: 0, totalVnd: 0 }
      byMonth.set(month, entry)
    }
    return entry
  }

  for (const f of fuelLogs) {
    if (f.costVnd == null) continue
    const entry = ensure(monthKey(f.recordedAt, accountTimezone))
    entry.fuelVnd += f.costVnd
    entry.totalVnd += f.costVnd
  }
  for (const s of serviceLogs) {
    if (s.costVnd == null) continue
    const entry = ensure(monthKey(s.servicedAt, accountTimezone))
    entry.serviceVnd += s.costVnd
    entry.totalVnd += s.costVnd
  }

  return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month))
}

/**
 * Chi phí trung bình / km trong N tháng gần nhất — thống kê tham khảo (KHÔNG phải
 * business rule trong decision.md), dùng cutoff theo UTC (xấp xỉ tháng lịch, đủ
 * chính xác cho 1 stat card).
 */
export async function getCostPerKm(accountId: string, vehicleId: string, monthsBack = 3): Promise<number | null> {
  const vehicle = await db.vehicles.get(vehicleId)
  if (!vehicle || vehicle.accountId !== accountId || vehicle.deletedAt != null) return null
  const cutoff = new Date()
  cutoff.setUTCMonth(cutoff.getUTCMonth() - monthsBack)
  const cutoffIso = cutoff.toISOString()

  const [fuelLogs, serviceLogs, odometerLogs] = await Promise.all([
    db.fuelLogs.where('vehicleId').equals(vehicleId).and((log) => log.accountId === accountId && log.deletedAt == null).toArray(),
    db.serviceLogs.where('vehicleId').equals(vehicleId).and((log) => log.accountId === accountId && log.deletedAt == null).toArray(),
    db.odometerLogs.where('vehicleId').equals(vehicleId).and((log) => log.accountId === accountId).toArray(),
  ])

  const totalCost =
    fuelLogs.filter((f) => f.recordedAt >= cutoffIso).reduce((sum, f) => sum + (f.costVnd ?? 0), 0) +
    serviceLogs.filter((s) => s.servicedAt >= cutoffIso).reduce((sum, s) => sum + (s.costVnd ?? 0), 0)

  const inWindow = odometerLogs.filter((o) => o.recordedAt >= cutoffIso)
  if (inWindow.length < 2) return null
  const kmValues = inWindow.map((o) => o.odometerKm)
  const kmDriven = Math.max(...kmValues) - Math.min(...kmValues)
  if (kmDriven <= 0) return null

  return totalCost / kmDriven
}
