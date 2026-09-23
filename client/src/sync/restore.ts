import { db } from '@/data/db'
import { assertActiveSyncAccount } from './sessionGuard'
import { pullChanges } from './pull'
import { useSyncStore } from '@/stores/useSyncStore'

const ENTITY_TABLES = [db.vehicles, db.reminderConfigs, db.odometerLogs, db.fuelLogs, db.serviceLogs, db.partTypes] as const

/** Discard the local account workspace and rebuild it from the server feed. */
export async function restoreFromServer(accountId: string): Promise<void> {
  assertActiveSyncAccount(accountId)
  useSyncStore.getState().setRestoring()
  await db.transaction('rw', [...ENTITY_TABLES, db.outbox, db.syncMeta], async () => {
    for (const table of ENTITY_TABLES) {
      await table.where('accountId').equals(accountId).delete()
    }
    await db.outbox.where('accountId').equals(accountId).delete()
    const updated = await db.syncMeta.update(accountId, {
      lastSeenSeq: 0,
      lastSyncedAt: null,
      lastSyncError: null,
      bootstrapState: 'bootstrapping',
    })
    if (updated !== 1) throw new Error(`Sync metadata is missing for account ${accountId}`)
  })
  try {
    await pullChanges(accountId)
    const syncedAt = new Date().toISOString()
    await db.syncMeta.update(accountId, { bootstrapState: 'ready', lastSyncedAt: syncedAt, lastSyncError: null })
    useSyncStore.getState().setSynced(syncedAt)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Restore failed'
    await db.syncMeta.update(accountId, { lastSyncError: message, bootstrapState: 'bootstrapping' }).catch(() => undefined)
    useSyncStore.getState().setRetryable(message)
    throw error
  }
}
