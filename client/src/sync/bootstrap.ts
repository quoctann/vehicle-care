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
  const deviceId = getOrCreateDeviceId()
  const existing = await db.syncMeta.get(account.id)
  const bootstrapping: SyncMeta = {
    accountId: account.id,
    deviceId,
    lastSeenSeq: existing?.lastSeenSeq ?? 0,
    nextLocalSeq: existing?.nextLocalSeq ?? 1,
    lastSyncedAt: existing?.lastSyncedAt ?? null,
    lastSyncError: existing?.lastSyncError ?? null,
    bootstrapState: 'bootstrapping',
  }

  await db.syncMeta.put(bootstrapping)
  await api.registerDevice({
    device_id: deviceId,
    platform: 'web',
    app_version: '0.1.0',
  })
  assertActiveSyncAccount(account.id)

  await db.transaction('rw', [db.syncMeta, db.accountCache], async () => {
    await db.syncMeta.put(bootstrapping)
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
