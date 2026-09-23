import { generateId } from '@/lib/uuid'
import type { ServiceLog } from '@/domain/types'
import { db } from '../db'
import { serviceLogToPayload } from '../mappers'
import { enqueueMutation } from '../outbox'
import { assertVehicleOwned } from './ownership'

/**
 * Mỗi lần hoàn tất bảo dưỡng tạo 1 ServiceLog mới — KHÔNG sửa trực tiếp
 * ReminderConfig (reminder tự tính lại bằng cách đọc ServiceLog mới nhất, xem
 * `data/queries/reminderQueries.ts` + `domain/reminder.ts`).
 *
 * `odometerKmSnapshot` để `null` khi không rõ KM tại thời điểm service — caller
 * (UI log-entry) nên luôn truyền odometer hiện tại nếu có, để reminder theo KM
 * tính ổn định về sau (khuyến nghị decision.md, không bắt buộc).
 */
export async function addServiceLog(input: {
  accountId: string
  vehicleId: string
  partTypeId: string
  servicedAt?: string
  odometerKmSnapshot: number | null
  costVnd?: number | null
  note?: string | null
}): Promise<ServiceLog> {
  if (input.odometerKmSnapshot != null && (!Number.isFinite(input.odometerKmSnapshot) || input.odometerKmSnapshot < 0)) {
    throw new Error('Service odometer cannot be negative.')
  }
  if (input.costVnd != null && (!Number.isFinite(input.costVnd) || input.costVnd < 0)) throw new Error('Service cost cannot be negative.')
  if (input.servicedAt && Number.isNaN(Date.parse(input.servicedAt))) throw new Error('Service time is invalid.')
  const now = new Date().toISOString()
  const log: ServiceLog = {
    id: generateId(),
    accountId: input.accountId,
    vehicleId: input.vehicleId,
    partTypeId: input.partTypeId,
    servicedAt: input.servicedAt ?? now,
    odometerKmSnapshot: input.odometerKmSnapshot,
    costVnd: input.costVnd ?? null,
    note: input.note ?? null,
    deletedAt: null,
    createdAtClient: now,
    receivedAtServer: null,
    serverSeq: null,
  }
  await db.transaction('rw', [db.vehicles, db.partTypes, db.serviceLogs, db.outbox, db.syncMeta], async () => {
    await assertVehicleOwned(input.accountId, input.vehicleId)
    const partType = await db.partTypes.get(input.partTypeId)
    if (!partType || partType.accountId !== input.accountId || !partType.active) throw new Error('Unknown or inactive part type.')
    await db.serviceLogs.add(log)
    await enqueueMutation({
      accountId: input.accountId,
      entityType: 'service_log',
      operation: 'create',
      entityId: log.id,
      payload: serviceLogToPayload(log),
    })
  })
  return log
}

async function writeServiceLogPatch(accountId: string, id: string, patch: Partial<ServiceLog>): Promise<void> {
  await db.transaction('rw', [db.partTypes, db.serviceLogs, db.outbox, db.syncMeta], async () => {
    const current = await db.serviceLogs.get(id)
    if (!current || current.accountId !== accountId) throw new Error(`Service log not found: ${id}`)
    if (patch.partTypeId && patch.partTypeId !== current.partTypeId) {
      const partType = await db.partTypes.get(patch.partTypeId)
      if (!partType || partType.accountId !== accountId || !partType.active) throw new Error('Unknown or inactive part type.')
    }
    const updated: ServiceLog = { ...current, ...patch }
    await db.serviceLogs.put(updated)
    await enqueueMutation({
      accountId,
      entityType: 'service_log',
      operation: 'update',
      entityId: id,
      payload: serviceLogToPayload(updated),
    })
  })
}

/** Sửa 1 lần bảo dưỡng đã ghi (feedback Feature #3) — không cho đổi `vehicleId`. */
export function updateServiceLog(
  accountId: string,
  id: string,
  patch: Partial<Pick<ServiceLog, 'partTypeId' | 'servicedAt' | 'odometerKmSnapshot' | 'costVnd' | 'note'>>,
): Promise<void> {
  if (patch.odometerKmSnapshot != null && (!Number.isFinite(patch.odometerKmSnapshot) || patch.odometerKmSnapshot < 0)) {
    throw new Error('Service odometer cannot be negative.')
  }
  if (patch.costVnd != null && (!Number.isFinite(patch.costVnd) || patch.costVnd < 0)) throw new Error('Service cost cannot be negative.')
  if (patch.servicedAt && Number.isNaN(Date.parse(patch.servicedAt))) throw new Error('Service time is invalid.')
  return writeServiceLogPatch(accountId, id, patch)
}

/** Tombstone — không xóa vật lý (nhất quán với `vehicleRepository.deleteVehicle`). */
export function deleteServiceLog(accountId: string, id: string): Promise<void> {
  return writeServiceLogPatch(accountId, id, { deletedAt: new Date().toISOString() })
}
