import { useSessionStore } from '@/stores/useSessionStore';
import { ApiError } from '@/api/errors';
import { db, type SyncMeta } from '@/data/db';

export type SyncSessionContext = Readonly<{ accountId: string; sessionGeneration: number }>;

export class StaleSyncOperationError extends Error {
  constructor() {
    super('The active session changed during sync.');
    this.name = 'StaleSyncOperationError';
  }
}

export function captureSyncSession(accountId: string): SyncSessionContext {
  const context = Object.freeze({
    accountId,
    sessionGeneration: useSessionStore.getState().sessionGeneration,
  });
  assertCurrentSyncSession(context);
  return context;
}

export function isCurrentSyncSession(context: SyncSessionContext): boolean {
  const session = useSessionStore.getState();
  return (
    session.status === 'authenticated' &&
    session.account?.id === context.accountId &&
    session.sessionGeneration === context.sessionGeneration
  );
}

export function assertCurrentSyncSession(context: SyncSessionContext): void {
  if (!isCurrentSyncSession(context)) throw new StaleSyncOperationError();
}

export function assertSyncResponseAccount(response: unknown, context: SyncSessionContext): void {
  assertCurrentSyncSession(context);
  if (
    !response ||
    typeof response !== 'object' ||
    !('account_id' in response) ||
    response.account_id !== context.accountId
  ) {
    throw new Error('The sync response account does not match. Refresh and sign in again.');
  }
}

export async function updateSyncMetadata(
  context: SyncSessionContext,
  changes: Partial<SyncMeta>,
): Promise<void> {
  await db.transaction('rw', db.syncMeta, async () => {
    assertCurrentSyncSession(context);
    await db.syncMeta.update(context.accountId, changes);
    assertCurrentSyncSession(context);
  });
}

/** Authentication failures may expire only the exact session that issued the request. */
export async function expireSyncSession(
  error: unknown,
  context: SyncSessionContext,
): Promise<void> {
  if (
    !(error instanceof ApiError) ||
    !(error.status === 401 || error.code === 'session_expired' || error.code === 'auth_invalid') ||
    !isCurrentSyncSession(context)
  )
    return;
  try {
    await db.transaction('rw', db.accountCache, async () => {
      const cached = await db.accountCache.get('current');
      assertCurrentSyncSession(context);
      if (cached?.accountId === context.accountId) await db.accountCache.delete('current');
      assertCurrentSyncSession(context);
    });
  } catch {
    // A cache failure must not replace the original HTTP error or clear a newer login.
  }
  if (isCurrentSyncSession(context)) useSessionStore.getState().clear();
}
