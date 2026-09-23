import { db } from '@/data/db'
import { assertActiveSyncAccount } from './sessionGuard'
import { pullChanges } from './pull'
import { useSyncStore } from '@/stores/useSyncStore'
import { withAccountSyncLock } from './accountLock'
import { ApiError } from '@/api/errors'
import { useSessionStore } from '@/stores/useSessionStore'

const ENTITY_TABLES = [db.vehicles, db.reminderConfigs, db.odometerLogs, db.fuelLogs, db.serviceLogs, db.partTypes] as const

async function performRestore(accountId: string, resumeOnly = false): Promise<void> {
  assertActiveSyncAccount(accountId)
  const existing = await db.syncMeta.get(accountId)
  if (!existing) throw new Error(`Sync metadata is missing for account ${accountId}`)
  if (resumeOnly && existing.operation === 'idle') return
  useSyncStore.getState().setRestoring()

  if (existing.operation === 'idle') {
    await db.transaction('rw', [...ENTITY_TABLES, db.outbox, db.syncMeta], async () => {
      const marked = await db.syncMeta.update(accountId, { operation: 'restoring', lastSyncError: null, lastSyncFailureKind: null })
      if (marked !== 1) throw new Error(`Sync metadata is missing for account ${accountId}`)
      for (const table of ENTITY_TABLES) {
        await table.where('accountId').equals(accountId).delete()
      }
      await db.outbox.where('accountId').equals(accountId).delete()
      await db.syncMeta.update(accountId, {
        lastSeenSeq: 0,
        lastSyncedAt: null,
        bootstrapState: 'bootstrapping',
      })
    })
  } else {
    await db.syncMeta.update(accountId, { operation: 'restoring', lastSyncError: null, lastSyncFailureKind: null })
  }
  try {
    const result = await pullChanges(accountId)
    if (result === 'deferred') throw new Error('Workspace recovery cannot finish while local mutations exist.')
    assertActiveSyncAccount(accountId)
    const syncedAt = new Date().toISOString()
    await db.syncMeta.update(accountId, {
      operation: 'idle',
      bootstrapState: 'ready',
      lastSyncedAt: syncedAt,
      lastSyncError: null,
      lastSyncFailureKind: null,
    })
    useSyncStore.getState().setSynced(syncedAt)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Restore failed'
    await db.syncMeta.update(accountId, {
      operation: 'restore_failed',
      lastSyncError: message,
      lastSyncFailureKind: 'retryable',
      bootstrapState: 'bootstrapping',
    }).catch(() => undefined)
    useSyncStore.getState().setRetryable(message)
    if (error instanceof ApiError && (error.status === 401 || error.code === 'session_expired' || error.code === 'auth_invalid')) {
      await db.accountCache.delete('current').catch(() => undefined)
      useSessionStore.getState().clear()
    }
    throw error
  }
}

/** Discard the local account workspace and rebuild it from the server feed. */
export function restoreFromServer(accountId: string): Promise<void> {
  return withAccountSyncLock(accountId, () => performRestore(accountId))
}

/** Continue an interrupted restore without starting a new destructive restore after another tab completed it. */
export function resumeRestoreFromServer(accountId: string): Promise<void> {
  return withAccountSyncLock(accountId, () => performRestore(accountId, true))
}
