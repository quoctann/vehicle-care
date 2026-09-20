import type { IsoDateTime } from '@/domain/types'
import { db } from '../db'

export type HistoryEntry = {
  id: string
  kind: 'fuel' | 'service'
  occurredAt: IsoDateTime
  title: string
  liters: number | null
  costVnd: number | null
  note: string | null
}

/** Hợp nhất FuelLog + ServiceLog thành 1 timeline cho màn History, mới nhất trước. */
export async function listHistoryEntries(accountId: string, vehicleId: string): Promise<HistoryEntry[]> {
  const vehicle = await db.vehicles.get(vehicleId)
  if (!vehicle || vehicle.accountId !== accountId || vehicle.deletedAt != null) return []
  const [fuelLogs, serviceLogs, partTypes] = await Promise.all([
    db.fuelLogs.where('vehicleId').equals(vehicleId).and((log) => log.accountId === accountId && log.deletedAt == null).toArray(),
    db.serviceLogs.where('vehicleId').equals(vehicleId).and((log) => log.accountId === accountId && log.deletedAt == null).toArray(),
    db.partTypes.toArray(),
  ])
  const partTypeById = new Map(partTypes.map((p) => [p.id, p]))

  const fuelEntries: HistoryEntry[] = fuelLogs.map((f) => ({
    id: f.id,
    kind: 'fuel',
    occurredAt: f.recordedAt,
    title: '',
    liters: f.liters,
    costVnd: f.costVnd,
    note: f.note,
  }))

  const serviceEntries: HistoryEntry[] = serviceLogs.map((s) => ({
    id: s.id,
    kind: 'service',
    occurredAt: s.servicedAt,
    title: partTypeById.get(s.partTypeId)?.displayName ?? '',
    liters: null,
    costVnd: s.costVnd,
    note: s.note,
  }))

  return [...fuelEntries, ...serviceEntries].sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1))
}
