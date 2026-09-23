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
    operation: 'idle',
    lastSyncedAt: null,
    lastSyncError: null,
    lastSyncFailureKind: null,
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
  if (meta.operation !== 'idle') throw new Error('Workspace recovery is in progress. Finish recovery before editing data.')
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

export function getNextOutboxItem(accountId: string, throughLocalSeq = Number.MAX_SAFE_INTEGER): Promise<OutboxItem | undefined> {
  return listOutboxForAccount(accountId).then((rows) => rows.find((item) => item.localSeq <= throughLocalSeq))
}

export async function getOutboxHighWatermark(accountId: string): Promise<number | null> {
  const rows = await listOutboxForAccount(accountId)
  return rows.length === 0 ? null : Math.max(...rows.map((item) => item.localSeq))
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
  return db.outbox.where('accountId').equals(accountId).sortBy('localSeq')
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
    if (!current || current.status !== 'blocked') throw new Error(`Blocked mutation not found: ${mutationId}`)
    const item = current
    const meta = await db.syncMeta.get(item.accountId) ?? newSyncMeta(item.accountId)
    if (meta.operation !== 'idle') throw new Error('Workspace recovery is in progress.')
    const existing = await table.get(item.entityId) as { accountId?: string } | undefined
    if (!existing || existing.accountId !== item.accountId) throw new Error(`Entity not found for blocked mutation: ${item.entityId}`)
    const fields = repairFields(item.entityType, payload)
    const newerRows = await db.outbox
      .where('[accountId+localSeq]')
      .between([item.accountId, item.localSeq + 1], [item.accountId, Dexie.maxKey])
      .filter((candidate) => candidate.entityType === item.entityType && candidate.entityId === item.entityId)
      .count()
    if (newerRows === 0) await table.update(item.entityId, fields)
    await db.outbox.delete(mutationId)
    const replacement: OutboxItem = {
      ...item,
      mutationId: generateId(),
      operation: operation ?? item.operation,
      payload,
      status: 'pending',
      retryCount: 0,
      failureKind: null,
      lastError: null,
      createdAt: new Date().toISOString(),
    }
    await db.outbox.add(replacement)
    return replacement
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
