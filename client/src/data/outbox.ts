import { generateId } from '@/lib/uuid'
import { getOrCreateDeviceId } from '@/lib/deviceId'
import Dexie from 'dexie'
import { db, type OutboxEntityType, type OutboxFailureKind, type OutboxItem, type OutboxOperation, type OutboxStatus, type SyncMeta } from './db'
import {
  fuelLogFieldsFromPayload,
  odometerLogFieldsFromPayload,
  partTypeFieldsFromPayload,
  reminderConfigFieldsFromPayload,
  serviceLogFieldsFromPayload,
  vehicleFieldsFromPayload,
} from './mappers'

function entityTable(entityType: OutboxEntityType) {
  switch (entityType) {
    case 'vehicle': return db.vehicles
    case 'reminder_config': return db.reminderConfigs
    case 'odometer_log': return db.odometerLogs
    case 'fuel_log': return db.fuelLogs
    case 'service_log': return db.serviceLogs
    case 'part_type': return db.partTypes
  }
}

function newSyncMeta(accountId: string, nextLocalSeq = 1): SyncMeta {
  return {
    accountId,
    deviceId: getOrCreateDeviceId(),
    lastSeenSeq: 0,
    nextLocalSeq,
    lastSyncedAt: null,
    lastSyncError: null,
    bootstrapState: 'empty',
  }
}

/**
 * Must be called from the same transaction as the entity write. The mutation
 * envelope is immutable after this function returns, including its revision.
 */
export async function enqueueMutation(params: {
  accountId: string
  entityType: OutboxEntityType
  operation: OutboxOperation
  entityId: string
  payload: Record<string, unknown>
}): Promise<OutboxItem> {
  const table = entityTable(params.entityType)
  const entity = await table.get(params.entityId) as { accountId?: string; serverSeq?: number | null } | undefined
  if (entity?.accountId && entity.accountId !== params.accountId) throw new Error('Cannot enqueue a mutation for another account.')

  const meta = await db.syncMeta.get(params.accountId) ?? newSyncMeta(params.accountId)
  const item: OutboxItem = {
    mutationId: generateId(),
    accountId: params.accountId,
    localSeq: meta.nextLocalSeq,
    entityType: params.entityType,
    operation: params.operation,
    entityId: params.entityId,
    payload: params.payload,
    baseServerSeq: entity?.serverSeq ?? null,
    status: 'pending',
    retryCount: 0,
    lastError: null,
    failureKind: null,
    createdAt: new Date().toISOString(),
  }
  await db.outbox.add(item)
  await db.syncMeta.put({ ...meta, nextLocalSeq: meta.nextLocalSeq + 1 })
  return item
}

export function listPendingOutbox(accountId: string, limit: number): Promise<OutboxItem[]> {
  return db.outbox
    .where('[accountId+status+localSeq]')
    .between([accountId, 'pending', Dexie.minKey], [accountId, 'pending', Dexie.maxKey])
    .limit(limit)
    .toArray()
}

export function getNextOutboxItem(accountId: string): Promise<OutboxItem | undefined> {
  return db.outbox.where('[accountId+localSeq]').between([accountId, Dexie.minKey], [accountId, Dexie.maxKey]).first()
}

export function countPendingOutbox(): Promise<number> {
  return db.outbox.where('status').equals('pending' satisfies OutboxStatus).count()
}

export function countPendingOutboxForAccount(accountId: string): Promise<number> {
  return db.outbox.where('[accountId+status+localSeq]').between([accountId, 'pending', Dexie.minKey], [accountId, 'pending', Dexie.maxKey]).count()
}

export function countUnresolvedOutboxForAccount(accountId: string): Promise<number> {
  return db.outbox.where('accountId').equals(accountId).count()
}

export function listOutboxForAccount(accountId: string): Promise<OutboxItem[]> {
  return db.outbox.where('[accountId+localSeq]').between([accountId, Dexie.minKey], [accountId, Dexie.maxKey]).toArray()
}

export function listBlockedOutboxForAccount(accountId: string): Promise<OutboxItem[]> {
  return listOutboxForAccount(accountId).then((rows) => rows.filter((item) => item.status === 'blocked'))
}

export async function markOutboxAcknowledged(mutationId: string): Promise<void> {
  await db.outbox.delete(mutationId)
}

export async function markOutboxBlocked(mutationId: string, error: string): Promise<void> {
  await db.outbox.update(mutationId, {
    status: 'blocked' satisfies OutboxStatus,
    lastError: error,
    failureKind: 'terminal' satisfies OutboxFailureKind,
  })
}

export async function markOutboxRetryable(mutationId: string, error: string): Promise<void> {
  const current = await db.outbox.get(mutationId)
  if (!current) return
  await db.outbox.update(mutationId, {
    status: 'pending' satisfies OutboxStatus,
    retryCount: current.retryCount + 1,
    lastError: error,
    failureKind: 'retryable' satisfies OutboxFailureKind,
  })
}

/** Replace a terminal mutation rather than retrying its old envelope. */
export async function repairBlockedMutation(
  mutationId: string,
  payload: Record<string, unknown>,
  operation?: OutboxOperation,
): Promise<OutboxItem> {
  const blocked = await db.outbox.get(mutationId)
  if (!blocked || blocked.status !== 'blocked') throw new Error(`Blocked mutation not found: ${mutationId}`)
  const table = entityTable(blocked.entityType)
  return db.transaction('rw', [db.outbox, db.syncMeta, table], async () => {
    const current = await db.outbox.get(mutationId)
    const item = current ?? blocked
    const meta = await db.syncMeta.get(item.accountId) ?? newSyncMeta(item.accountId)
    if (meta.nextLocalSeq <= item.localSeq) await db.syncMeta.put({ ...meta, nextLocalSeq: item.localSeq + 1 })
    const existing = await table.get(item.entityId) as { accountId?: string } | undefined
    if (!existing || existing.accountId !== item.accountId) throw new Error(`Entity not found for blocked mutation: ${item.entityId}`)
    const fields = repairFields(item.entityType, payload)
    await table.update(item.entityId, fields)
    await db.outbox.delete(mutationId)
    const replacement = await enqueueMutation({
      accountId: item.accountId,
      entityType: item.entityType,
      operation: operation ?? item.operation,
      entityId: item.entityId,
      payload,
    })
    // Keep the repaired mutation at the blocked item's queue position so
    // later mutations cannot bypass the repaired dependency.
    await db.outbox.update(replacement.mutationId, { localSeq: item.localSeq, failureKind: null, lastError: null })
    return { ...replacement, localSeq: item.localSeq, failureKind: null, lastError: null }
  })
}

function repairFields(entityType: OutboxEntityType, payload: Record<string, unknown>): Record<string, unknown> {
  switch (entityType) {
    case 'vehicle': return vehicleFieldsFromPayload(payload)
    case 'reminder_config': return reminderConfigFieldsFromPayload(payload)
    case 'odometer_log': return odometerLogFieldsFromPayload(payload)
    case 'fuel_log': return fuelLogFieldsFromPayload(payload)
    case 'service_log': return serviceLogFieldsFromPayload(payload)
    case 'part_type': return partTypeFieldsFromPayload(payload)
  }
}

export async function clearRetryableFailure(mutationId: string): Promise<void> {
  const item = await db.outbox.get(mutationId)
  if (!item || item.status !== 'pending' || item.failureKind !== 'retryable') return
  await db.outbox.update(mutationId, { lastError: null, failureKind: null })
}

export async function deleteBlockedMutationsForEntity(accountId: string, entityType: OutboxEntityType, entityId: string): Promise<void> {
  const rows = await db.outbox.where('accountId').equals(accountId).toArray()
  await Promise.all(rows.filter((item) => item.entityType === entityType && item.entityId === entityId && item.status === 'blocked').map((item) => db.outbox.delete(item.mutationId)))
}
