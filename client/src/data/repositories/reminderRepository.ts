import { generateDeterministicId } from '@/lib/uuid'
import { validateReminderInterval } from '@/domain/validation'
import type { ReminderConfig } from '@/domain/types'
import { db } from '../db'
import { reminderConfigToPayload } from '../mappers'
import { enqueueMutation } from '../outbox'
import { assertVehicleOwned } from './ownership'

/** A3: unique (vehicleId, partTypeId) trong số reminder CHƯA tombstone — Dexie không có partial unique index nên enforce ở đây. */
async function assertNoActiveDuplicate(vehicleId: string, partTypeId: string, excludeId?: string): Promise<void> {
  const existing = await db.reminderConfigs.where('[vehicleId+partTypeId]').equals([vehicleId, partTypeId]).toArray()
  const activeDuplicate = existing.find((r) => r.deletedAt == null && r.id !== excludeId)
  if (activeDuplicate) {
    throw new Error(`Reminder cho part type này đã tồn tại trên xe (id=${activeDuplicate.id}) — hãy sửa thay vì tạo mới.`)
  }
}

export async function createReminderConfig(input: {
  accountId: string
  vehicleId: string
  partTypeId: string
  intervalKm: number | null
  intervalDays: number | null
  baselineOdometerKm: number | null
  baselineDate: string | null
}): Promise<ReminderConfig> {
  const validation = validateReminderInterval(input.intervalKm, input.intervalDays)
  if (!validation.valid) throw new Error(`Interval không hợp lệ: ${validation.error}`)

  const now = new Date().toISOString()
  const id = await generateDeterministicId(`${input.accountId}\0${input.vehicleId}\0${input.partTypeId}`)
  const reminder: ReminderConfig = {
    id,
    accountId: input.accountId,
    vehicleId: input.vehicleId,
    partTypeId: input.partTypeId,
    intervalKm: input.intervalKm,
    intervalDays: input.intervalDays,
    baselineOdometerKm: input.baselineOdometerKm,
    baselineDate: input.baselineDate,
    enabled: true,
    deletedAt: null,
    createdAtClient: now,
    receivedAtServer: null,
    serverSeq: null,
  }

  await db.transaction('rw', [db.vehicles, db.partTypes, db.reminderConfigs, db.outbox, db.syncMeta], async () => {
    await assertVehicleOwned(input.accountId, input.vehicleId)
    const partType = await db.partTypes.get(input.partTypeId)
    if (!partType || partType.accountId !== input.accountId || !partType.active) throw new Error('Unknown or inactive part type.')
    await assertNoActiveDuplicate(input.vehicleId, input.partTypeId)
    const existing = await db.reminderConfigs.get(id)
    if (existing && (existing.accountId !== input.accountId || existing.deletedAt == null)) {
      throw new Error('Reminder config already exists.')
    }
    await db.reminderConfigs.put(existing ? { ...reminder, createdAtClient: existing.createdAtClient } : reminder)
    await enqueueMutation({
      accountId: input.accountId,
      entityType: 'reminder_config',
      operation: existing?.serverSeq != null ? 'update' : 'create',
      entityId: reminder.id,
      payload: reminderConfigToPayload(reminder),
    })
  })
  return reminder
}

async function writeReminderPatch(accountId: string, id: string, patch: Partial<ReminderConfig>): Promise<void> {
  await db.transaction('rw', [db.reminderConfigs, db.outbox, db.syncMeta], async () => {
    const current = await db.reminderConfigs.get(id)
    if (!current || current.accountId !== accountId) throw new Error(`ReminderConfig not found: ${id}`)
    const updated: ReminderConfig = { ...current, ...patch }

    const intervalKm = patch.intervalKm !== undefined ? patch.intervalKm : current.intervalKm
    const intervalDays = patch.intervalDays !== undefined ? patch.intervalDays : current.intervalDays
    if (updated.deletedAt == null) {
      const validation = validateReminderInterval(intervalKm, intervalDays)
      if (!validation.valid) throw new Error(`Interval không hợp lệ: ${validation.error}`)
    }

    await db.reminderConfigs.put(updated)
    await enqueueMutation({
      accountId,
      entityType: 'reminder_config',
      operation: 'update',
      entityId: id,
      payload: reminderConfigToPayload(updated),
    })
  })
}

export function updateReminderConfig(
  accountId: string,
  id: string,
  patch: Partial<Pick<ReminderConfig, 'intervalKm' | 'intervalDays' | 'enabled'>>,
): Promise<void> {
  return writeReminderPatch(accountId, id, patch)
}

/** Tombstone — không xóa vật lý. */
export function deleteReminderConfig(accountId: string, id: string): Promise<void> {
  return writeReminderPatch(accountId, id, { deletedAt: new Date().toISOString() })
}
