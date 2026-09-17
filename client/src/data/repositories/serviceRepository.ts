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
    createdAtClient: now,
    receivedAtServer: null,
    serverSeq: null,
  }
  await db.transaction('rw', db.vehicles, db.partTypes, db.serviceLogs, db.outbox, async () => {
    await assertVehicleOwned(input.accountId, input.vehicleId)
    if (!(await db.partTypes.get(input.partTypeId))) throw new Error('Unknown part type.')
    await db.serviceLogs.add(log)
    await enqueueMutation({
      entityType: 'service_log',
      operation: 'create',
      entityId: log.id,
      payload: serviceLogToPayload(log),
    })
  })
  return log
}
