import { db } from '@/data/db';
import { countUnresolvedOutboxForAccount, getNextOutboxItem } from '@/data/outbox';
import { ApiError } from '@/api/errors';
import { useSessionStore } from '@/stores/useSessionStore';
import { useSyncStore } from '@/stores/useSyncStore';
import { bootstrapSync } from './bootstrap';
import { pullChanges } from './pull';
import { pushOutbox, SyncBlockedError, SyncRetryableError } from './push';
import {
  captureSyncSession,
  assertCurrentSyncSession,
  isCurrentSyncSession,
  updateSyncMetadata,
  expireSyncSession,
  type SyncSessionContext,
} from './sessionGuard';
import { withAccountSyncLock } from './accountLock';

const inFlight = new Map<string, Promise<void>>();

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Sync failed';
}

async function deferSync(context: SyncSessionContext): Promise<void> {
  await updateSyncMetadata(context, { lastSyncError: null, lastSyncFailureKind: null });
  if (isCurrentSyncSession(context)) useSyncStore.getState().setPending();
}

async function performSync(
  account: NonNullable<ReturnType<typeof useSessionStore.getState>['account']>,
  context: SyncSessionContext,
): Promise<void> {
  assertCurrentSyncSession(context);
  useSyncStore.getState().setSyncing();
  await updateSyncMetadata(context, { lastSyncError: null, lastSyncFailureKind: null }).catch(
    () => undefined,
  );

  try {
    assertCurrentSyncSession(context);
    const { accountId, deviceId } = await bootstrapSync(account, context);
    assertCurrentSyncSession(context);
    await pushOutbox(deviceId, accountId, context);
    assertCurrentSyncSession(context);

    const unresolvedBeforePull = await countUnresolvedOutboxForAccount(accountId);
    assertCurrentSyncSession(context);
    if (unresolvedBeforePull > 0) {
      const next = await getNextOutboxItem(accountId);
      assertCurrentSyncSession(context);
      if (next?.status === 'blocked')
        throw new SyncBlockedError(next, next.lastError ?? 'Mutation needs attention');
      await deferSync(context);
      return;
    }

    const pullResult = await pullChanges(accountId, context);
    assertCurrentSyncSession(context);
    if (pullResult === 'deferred') {
      await deferSync(context);
      return;
    }

    const syncedAt = new Date().toISOString();
    const clean = await db.transaction('rw', db.outbox, db.syncMeta, async () => {
      const clean = (await countUnresolvedOutboxForAccount(accountId)) === 0;
      assertCurrentSyncSession(context);
      await db.syncMeta.update(accountId, {
        ...(clean ? { lastSyncedAt: syncedAt } : {}),
        lastSyncError: null,
        lastSyncFailureKind: null,
        bootstrapState: 'ready',
      });
      assertCurrentSyncSession(context);
      return clean;
    });
    if (isCurrentSyncSession(context)) {
      if (clean) useSyncStore.getState().setSynced(syncedAt);
      else useSyncStore.getState().setPending();
    }
  } catch (error) {
    if (!isCurrentSyncSession(context)) throw error;
    const message = errorMessage(error);
    const failureKind =
      error instanceof SyncBlockedError
        ? 'blocked'
        : error instanceof ApiError && !error.retryable
          ? 'terminal'
          : 'retryable';
    await updateSyncMetadata(context, {
      lastSyncError: message,
      lastSyncFailureKind: failureKind,
    }).catch(() => undefined);
    await expireSyncSession(error, context);
    if (isCurrentSyncSession(context)) {
      if (error instanceof SyncBlockedError) useSyncStore.getState().setBlocked(message);
      else if (
        error instanceof SyncRetryableError ||
        !(error instanceof ApiError) ||
        error.retryable
      )
        useSyncStore.getState().setRetryable(message);
      else useSyncStore.getState().setError(message);
    }
    throw error;
  }
}

/** Runs push before pull and returns the same promise to concurrent callers. */
export function runSync(): Promise<void> {
  const { status, account } = useSessionStore.getState();
  if (status !== 'authenticated' || !account) return Promise.resolve();
  const context = captureSyncSession(account.id);
  const key = JSON.stringify([context.accountId, context.sessionGeneration]);
  const existing = inFlight.get(key);
  if (existing) return existing;
  const promise = withAccountSyncLock(account.id, () => performSync(account, context)).finally(
    () => {
      if (inFlight.get(key) === promise) inFlight.delete(key);
    },
  );
  inFlight.set(key, promise);
  return promise;
}
