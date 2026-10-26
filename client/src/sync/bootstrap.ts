import * as api from '@/api/client';
import { db, type SyncMeta } from '@/data/db';
import { getOrCreateDeviceId } from '@/lib/deviceId';
import { useSessionStore, type SessionAccount } from '@/stores/useSessionStore';
import {
  captureSyncSession,
  assertCurrentSyncSession,
  assertSyncResponseAccount,
  type SyncSessionContext,
} from './sessionGuard';

export type SyncBootstrap = {
  accountId: string;
  deviceId: string;
};

/** Registers this installation and creates the account-scoped local sync bookkeeping. */
export async function bootstrapSync(
  account: SessionAccount,
  context: SyncSessionContext = captureSyncSession(account.id),
): Promise<SyncBootstrap> {
  const assertCurrent = () => assertCurrentSyncSession(context);
  assertCurrent();
  const deviceId = await db.transaction('rw', db.syncMeta, async () => {
    const existing = await db.syncMeta.get(account.id);
    assertCurrent();
    // Dedupe uses (account, device, mutation). Never rotate the device identity
    // while its IndexedDB workspace survives, even if localStorage is cleared.
    const deviceId = existing?.deviceId || getOrCreateDeviceId();
    const bootstrapping: SyncMeta = existing
      ? { ...existing, deviceId, bootstrapState: 'bootstrapping' }
      : {
          accountId: account.id,
          deviceId,
          lastSeenSeq: 0,
          nextLocalSeq: 1,
          operation: 'idle',
          lastSyncedAt: null,
          lastSyncError: null,
          lastSyncFailureKind: null,
          bootstrapState: 'bootstrapping',
        };
    await db.syncMeta.put(bootstrapping);
    assertCurrent();
    return deviceId;
  });
  assertCurrent();
  const response = await api.registerDevice({
    expected_account_id: context.accountId,
    device_id: deviceId,
    platform: 'web',
    app_version: '0.1.0',
  });
  assertSyncResponseAccount(response, context);

  await db.transaction('rw', [db.syncMeta, db.accountCache], async () => {
    const current = await db.syncMeta.get(account.id);
    assertCurrent();
    if (!current) throw new Error(`Sync metadata disappeared for account ${account.id}`);
    await db.syncMeta.put({ ...current, deviceId, bootstrapState: 'bootstrapping' });
    assertCurrent();
    const latestAccount = useSessionStore.getState().account!;
    await db.accountCache.put({
      id: 'current',
      accountId: account.id,
      email: latestAccount.email,
      name: latestAccount.name,
      timezone: latestAccount.timezone,
      emailVerified: latestAccount.emailVerified,
      deviceId,
      cachedAt: new Date().toISOString(),
    });
    assertCurrent();
  });

  assertCurrent();
  return { accountId: account.id, deviceId };
}
