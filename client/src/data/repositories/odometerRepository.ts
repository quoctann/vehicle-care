import { generateId } from '@/lib/uuid'
import { validateOdometerReading } from '@/domain/validation'
import type { OdometerLog } from '@/domain/types'
import { db } from '../db'
import { odometerLogToPayload } from '../mappers'
import { enqueueMutation } from '../outbox'
import { assertVehicleOwned } from './ownership'

/**
 * D-02: caller (UI) chịu trách nhiệm hỏi/hiển thị cảnh báo "thấp hơn hiện tại"
 * TRƯỚC khi gọi hàm này — ở đây chỉ chặn giá trị thật sự bất khả thi (âm), không
 * chặn lại lần nữa vì cảnh báo không phải lỗi.
 */
export async function addOdometerLog(input: {
  accountId: string
  vehicleId: string
  odometerKm: number
  recordedAt?: string
  note?: string | null
  source?: OdometerLog['source']
}): Promise<OdometerLog> {
  const validation = validateOdometerReading(input.odometerKm, null)
  if (!validation.valid) throw new Error(`Odometer không hợp lệ: ${validation.error}`)
  if (input.recordedAt && Number.isNaN(Date.parse(input.recordedAt))) throw new Error('Recorded time is invalid.')

  const now = new Date().toISOString()
  const log: OdometerLog = {
    id: generateId(),
    accountId: input.accountId,
    vehicleId: input.vehicleId,
    odometerKm: input.odometerKm,
    recordedAt: input.recordedAt ?? now,
    note: input.note ?? null,
    source: input.source ?? 'manual',
    createdAtClient: now,
    receivedAtServer: null,
    serverSeq: null,
  }
  await db.transaction('rw', db.vehicles, db.odometerLogs, db.outbox, async () => {
    await assertVehicleOwned(input.accountId, input.vehicleId)
    await db.odometerLogs.add(log)
    await enqueueMutation({
      entityType: 'odometer_log',
      operation: 'create',
      entityId: log.id,
      payload: odometerLogToPayload(log),
    })
  })
  return log
}
