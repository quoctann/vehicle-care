import * as api from '@/api/client'
import { db, type SyncMeta } from '@/data/db'
import { getOrCreateDeviceId } from '@/lib/deviceId'
import type { SessionAccount } from '@/stores/useSessionStore'
import { assertActiveSyncAccount } from './sessionGuard'

export type SyncBootstrap = {
  accountId: string
  deviceId: string
}

/** Registers this installation and creates the account-scoped local sync bookkeeping. */
export async function bootstrapSync(account: SessionAccount): Promise<SyncBootstrap> {
  assertActiveSyncAccount(account.id)
  const deviceId = await db.transaction('rw', db.syncMeta, async () => {
    const existing = await db.syncMeta.get(account.id)
    // Dedupe uses (account, device, mutation). Never rotate the device identity
    // while its IndexedDB workspace survives, even if localStorage is cleared.
    const deviceId = existing?.deviceId || getOrCreateDeviceId()
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
        }
    await db.syncMeta.put(bootstrapping)
    return deviceId
  })
  await api.registerDevice({
    device_id: deviceId,
    platform: 'web',
    app_version: '0.1.0',
  })
  assertActiveSyncAccount(account.id)

  await db.transaction('rw', [db.syncMeta, db.accountCache], async () => {
    const current = await db.syncMeta.get(account.id)
    if (!current) throw new Error(`Sync metadata disappeared for account ${account.id}`)
    await db.syncMeta.put({ ...current, deviceId, bootstrapState: 'bootstrapping' })
    await db.accountCache.put({
      id: 'current',
      accountId: account.id,
      email: account.email,
      name: account.name,
      timezone: account.timezone,
      emailVerified: account.emailVerified,
      deviceId,
      cachedAt: new Date().toISOString(),
    })
  })

  return { accountId: account.id, deviceId }
}
