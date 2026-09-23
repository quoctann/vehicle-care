import { db } from '@/data/db'
import { countUnresolvedOutboxForAccount } from '@/data/outbox'
import { ApiError } from '@/api/errors'
import { useSessionStore } from '@/stores/useSessionStore'
import { useSyncStore } from '@/stores/useSyncStore'
import { bootstrapSync } from './bootstrap'
import { pullChanges } from './pull'
import { pushOutbox, SyncBlockedError, SyncRetryableError } from './push'
import { assertActiveSyncAccount } from './sessionGuard'

let inFlight: { accountId: string; promise: Promise<void> } | null = null

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Sync failed'
}

async function performSync(account: NonNullable<ReturnType<typeof useSessionStore.getState>['account']>): Promise<void> {
  useSyncStore.getState().setSyncing()

  try {
    const { accountId, deviceId } = await bootstrapSync(account)
    assertActiveSyncAccount(accountId)
    await pushOutbox(deviceId, accountId)
    assertActiveSyncAccount(accountId)

    const unresolvedBeforePull = await countUnresolvedOutboxForAccount(accountId)
    if (unresolvedBeforePull > 0) {
      throw new Error(`${unresolvedBeforePull} thay đổi chưa được đồng bộ. Hãy kiểm tra và thử lại.`)
    }

    await pullChanges(accountId)
    assertActiveSyncAccount(accountId)

    const unresolvedCount = await countUnresolvedOutboxForAccount(accountId)
    if (unresolvedCount > 0) {
      await db.syncMeta.update(accountId, { lastSyncError: null, bootstrapState: 'ready' })
      if (useSessionStore.getState().account?.id === accountId) useSyncStore.getState().setPending()
      return
    }

    const syncedAt = new Date().toISOString()
    await db.syncMeta.update(accountId, {
      lastSyncedAt: syncedAt,
      lastSyncError: null,
      bootstrapState: 'ready',
    })
    if (useSessionStore.getState().account?.id === accountId) useSyncStore.getState().setSynced(syncedAt)
  } catch (error) {
    const message = errorMessage(error)
    await db.syncMeta.update(account.id, { lastSyncError: message }).catch(() => undefined)
    if (error instanceof ApiError && (error.status === 401 || error.code === 'session_expired' || error.code === 'auth_invalid')) {
      useSessionStore.getState().clear()
    }
    if (useSessionStore.getState().account?.id === account.id) {
      if (error instanceof SyncBlockedError) useSyncStore.getState().setBlocked(message)
      else if (error instanceof SyncRetryableError || !(error instanceof ApiError) || error.retryable) useSyncStore.getState().setRetryable(message)
      else useSyncStore.getState().setError(message)
    }
    throw error
  }
}

async function runWithAccountLock(accountId: string, work: () => Promise<void>): Promise<void> {
  if (typeof navigator !== 'undefined' && 'locks' in navigator) {
    return navigator.locks.request(`vehicle-sync:${accountId}`, { mode: 'exclusive' }, work)
  }
  return work()
}

/** Runs push before pull and returns the same promise to concurrent callers. */
export function runSync(): Promise<void> {
  const { status, account } = useSessionStore.getState()
  if (status !== 'authenticated' || !account) return Promise.resolve()

  if (inFlight) {
    if (inFlight.accountId === account.id) return inFlight.promise
    return inFlight.promise.catch(() => undefined).then(runSync)
  }

  const promise = runWithAccountLock(account.id, () => performSync(account)).finally(() => {
    if (inFlight?.promise === promise) inFlight = null
  })
  inFlight = { accountId: account.id, promise }
  return promise
}
