import { generateId } from '@/lib/uuid'
import { db, type OutboxEntityType, type OutboxItem, type OutboxOperation, type OutboxStatus } from './db'

/**
 * Phải gọi hàm này BÊN TRONG cùng 1 `db.transaction('rw', [entityTable, db.outbox], ...)`
 * với lệnh ghi entity — Dexie tự động gộp mọi lệnh gọi table trong lúc transaction
 * đang chạy (kể cả gọi từ hàm khác) vào ĐÚNG 1 transaction đó, miễn là nằm trong
 * cùng chuỗi async liên tục (không qua `setTimeout`/tách luồng).
 */
export async function enqueueMutation(params: {
  entityType: OutboxEntityType
  operation: OutboxOperation
  entityId: string
  payload: Record<string, unknown>
}): Promise<void> {
  const item: OutboxItem = {
    mutationId: generateId(),
    entityType: params.entityType,
    operation: params.operation,
    entityId: params.entityId,
    payload: params.payload,
    status: 'pending',
    retryCount: 0,
    lastError: null,
    createdAt: new Date().toISOString(),
  }
  await db.outbox.add(item)
}

export function listPendingOutbox(limit: number): Promise<OutboxItem[]> {
  return db.outbox.where('status').equals('pending' satisfies OutboxStatus).sortBy('createdAt').then((rows) => rows.slice(0, limit))
}

export function countPendingOutbox(): Promise<number> {
  return db.outbox.where('status').equals('pending' satisfies OutboxStatus).count()
}

async function countOutboxForAccount(accountId: string, statuses: OutboxStatus[]): Promise<number> {
  const rows = (await Promise.all(statuses.map((status) => db.outbox.where('status').equals(status).toArray()))).flat()
  const ownership = await Promise.all(
    rows.map(async (item) => {
      switch (item.entityType) {
        case 'vehicle':
          return (await db.vehicles.get(item.entityId))?.accountId === accountId
        case 'reminder_config':
          return (await db.reminderConfigs.get(item.entityId))?.accountId === accountId
        case 'odometer_log':
          return (await db.odometerLogs.get(item.entityId))?.accountId === accountId
        case 'fuel_log':
          return (await db.fuelLogs.get(item.entityId))?.accountId === accountId
        case 'service_log':
          return (await db.serviceLogs.get(item.entityId))?.accountId === accountId
        case 'part_type':
          return (await db.partTypes.get(item.entityId))?.accountId === accountId
      }
    }),
  )
  return ownership.filter(Boolean).length
}

export function countPendingOutboxForAccount(accountId: string): Promise<number> {
  return countOutboxForAccount(accountId, ['pending'])
}

export function countUnresolvedOutboxForAccount(accountId: string): Promise<number> {
  return countOutboxForAccount(accountId, ['pending', 'rejected', 'retryable_error'])
}

export async function markOutboxApplied(mutationId: string): Promise<void> {
  await db.outbox.update(mutationId, { status: 'applied' satisfies OutboxStatus })
}

export async function markOutboxRejected(mutationId: string, error: string): Promise<void> {
  await db.outbox.update(mutationId, { status: 'rejected' satisfies OutboxStatus, lastError: error })
}

export async function markOutboxRetryable(mutationId: string, error: string): Promise<void> {
  const current = await db.outbox.get(mutationId)
  await db.outbox.update(mutationId, {
    status: 'pending' satisfies OutboxStatus,
    retryCount: (current?.retryCount ?? 0) + 1,
    lastError: error,
  })
}
