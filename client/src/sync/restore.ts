import { db } from '@/data/db';
import {
  captureSyncSession,
  assertCurrentSyncSession,
  isCurrentSyncSession,
  updateSyncMetadata,
  expireSyncSession,
  type SyncSessionContext,
} from './sessionGuard';
import { pullChanges } from './pull';
import { useSyncStore } from '@/stores/useSyncStore';
import { withAccountSyncLock } from './accountLock';

const ENTITY_TABLES = [
  db.vehicles,
  db.reminderConfigs,
  db.odometerLogs,
  db.fuelLogs,
  db.serviceLogs,
  db.partTypes,
] as const;

async function performRestore(context: SyncSessionContext, resumeOnly = false): Promise<void> {
  const { accountId } = context;
  assertCurrentSyncSession(context);
  const existing = await db.syncMeta.get(accountId);
  assertCurrentSyncSession(context);
  if (!existing) throw new Error(`Sync metadata is missing for account ${accountId}`);
  if (resumeOnly && existing.operation === 'idle') return;
  useSyncStore.getState().setRestoring();

  if (existing.operation === 'idle') {
    await db.transaction('rw', [...ENTITY_TABLES, db.outbox, db.syncMeta], async () => {
      assertCurrentSyncSession(context);
      const marked = await db.syncMeta.update(accountId, {
        operation: 'restoring',
        lastSyncError: null,
        lastSyncFailureKind: null,
      });
      assertCurrentSyncSession(context);
      if (marked !== 1) throw new Error(`Sync metadata is missing for account ${accountId}`);
      for (const table of ENTITY_TABLES) {
        await table.where('accountId').equals(accountId).delete();
        assertCurrentSyncSession(context);
      }
      await db.outbox.where('accountId').equals(accountId).delete();
      assertCurrentSyncSession(context);
      await db.syncMeta.update(accountId, {
        lastSeenSeq: 0,
        lastSyncedAt: null,
        bootstrapState: 'bootstrapping',
      });
      assertCurrentSyncSession(context);
    });
  } else {
    await updateSyncMetadata(context, {
      operation: 'restoring',
      lastSyncError: null,
      lastSyncFailureKind: null,
    });
  }
  try {
    assertCurrentSyncSession(context);
    const result = await pullChanges(accountId, context);
    if (result === 'deferred')
      throw new Error('Workspace recovery cannot finish while local mutations exist.');
    assertCurrentSyncSession(context);
    const syncedAt = new Date().toISOString();
    await updateSyncMetadata(context, {
      operation: 'idle',
      bootstrapState: 'ready',
      lastSyncedAt: syncedAt,
      lastSyncError: null,
      lastSyncFailureKind: null,
    });
    if (isCurrentSyncSession(context)) useSyncStore.getState().setSynced(syncedAt);
  } catch (error) {
    if (!isCurrentSyncSession(context)) throw error;
    const message = error instanceof Error ? error.message : 'Restore failed';
    await updateSyncMetadata(context, {
      operation: 'restore_failed',
      lastSyncError: message,
      lastSyncFailureKind: 'retryable',
      bootstrapState: 'bootstrapping',
    }).catch(() => undefined);
    if (isCurrentSyncSession(context)) useSyncStore.getState().setRetryable(message);
    await expireSyncSession(error, context);
    throw error;
  }
}

/** Discard the local account workspace and rebuild it from the server feed. */
export function restoreFromServer(accountId: string): Promise<void> {
  const context = captureSyncSession(accountId);
  return withAccountSyncLock(accountId, () => performRestore(context));
}

/** Continue an interrupted restore without starting a new destructive restore after another tab completed it. */
export function resumeRestoreFromServer(accountId: string): Promise<void> {
  const context = captureSyncSession(accountId);
  return withAccountSyncLock(accountId, () => performRestore(context, true));
}
