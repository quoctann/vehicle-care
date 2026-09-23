import * as api from '@/api/client'
import type { MutationResult, PushMutation } from '@/api/contract.types'
import { db, type OutboxItem } from '@/data/db'
import { getNextOutboxItem, getOutboxHighWatermark, markOutboxAcknowledged, markOutboxBlocked, markOutboxRetryable } from '@/data/outbox'
import { assertActiveSyncAccount } from './sessionGuard'
import { entityTable, updateEntitySyncMeta } from './types'

export class SyncBlockedError extends Error {
  readonly code = 'sync_blocked'
  readonly item: OutboxItem
  constructor(item: OutboxItem, message: string) {
    super(message)
    this.item = item
    this.name = 'SyncBlockedError'
  }
}

export class SyncRetryableError extends Error {
  readonly code = 'sync_retryable'
  readonly item: OutboxItem
  constructor(item: OutboxItem, message: string) {
    super(message)
    this.item = item
    this.name = 'SyncRetryableError'
  }
}

function validateResult(item: OutboxItem, result: MutationResult | undefined): MutationResult {
  if (!result || result.mutation_id !== item.mutationId) throw new Error('Sync push returned an invalid mutation result')
  if (
    (result.status === 'applied' || result.status === 'duplicate') &&
    (result.server_seq == null || result.received_at_server == null)
  ) {
    throw new Error(`Sync push omitted acknowledgment metadata for ${item.mutationId}`)
  }
  if (
    result.server_seq != null &&
    (!Number.isSafeInteger(result.server_seq) || result.server_seq <= 0 || !result.received_at_server || Number.isNaN(Date.parse(result.received_at_server)))
  ) {
    throw new Error(`Sync push returned invalid acknowledgment metadata for ${item.mutationId}`)
  }
  return result
}

async function applyMutationResult(item: OutboxItem, result: MutationResult): Promise<'continue' | 'stop'> {
  const table = entityTable(item.entityType)
  switch (result.status) {
    case 'applied':
    case 'duplicate':
      await db.transaction('rw', [db.outbox, table], async () => {
        const current = await table.get(item.entityId)
        const hasNewerLocalRevision = await db.outbox
          .where('[accountId+localSeq]')
          .between([item.accountId, item.localSeq + 1], [item.accountId, Number.MAX_SAFE_INTEGER])
          .filter((candidate) => candidate.entityType === item.entityType && candidate.entityId === item.entityId)
          .count()
        await markOutboxAcknowledged(item.mutationId)
        if (hasNewerLocalRevision === 0 && (current?.serverSeq == null || result.server_seq! >= current.serverSeq)) {
          await updateEntitySyncMeta(item.entityType, item.entityId, result.server_seq!, result.received_at_server!)
        }
      })
      return 'continue'
    case 'retryable_error':
      await db.transaction('rw', db.outbox, async () => {
        await markOutboxRetryable(item.mutationId, result.error_message ?? 'Retryable server error')
      })
      throw new SyncRetryableError(item, result.error_message ?? 'Retryable server error')
    case 'rejected':
      await db.transaction('rw', db.outbox, async () => {
        await markOutboxBlocked(item.mutationId, result.error_message ?? 'Rejected by server')
      })
      throw new SyncBlockedError(item, result.error_message ?? 'Rejected by server')
  }
}

/** Pushes one immutable envelope at a time, in account-local FIFO order. */
export async function pushOutbox(deviceId: string, accountId: string): Promise<void> {
  const throughLocalSeq = await getOutboxHighWatermark(accountId)
  if (throughLocalSeq == null) return
  while (true) {
    assertActiveSyncAccount(accountId)
    const item = await getNextOutboxItem(accountId, throughLocalSeq)
    if (!item) return
    if (item.status === 'blocked') throw new SyncBlockedError(item, item.lastError ?? 'Mutation needs attention')

    const mutation: PushMutation = {
      mutation_id: item.mutationId,
      entity_type: item.entityType,
      operation: item.operation,
      entity_id: item.entityId,
      payload: item.payload as Record<string, unknown>,
    }
    const response = await api.pushMutations({
      device_id: deviceId,
      api_version: '1',
      mutations: [mutation],
    })
    assertActiveSyncAccount(accountId)
    if (response.results.length !== 1) throw new Error('Sync push returned an incomplete result set')
    const result = validateResult(item, response.results[0])
    await applyMutationResult(item, result)
  }
}
