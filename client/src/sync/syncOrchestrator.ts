import { db } from '@/data/db'
import { countUnresolvedOutboxForAccount, getNextOutboxItem } from '@/data/outbox'
import { ApiError } from '@/api/errors'
import { useSessionStore } from '@/stores/useSessionStore'
import { useSyncStore } from '@/stores/useSyncStore'
import { bootstrapSync } from './bootstrap'
import { pullChanges } from './pull'
import { pushOutbox, SyncBlockedError, SyncRetryableError } from './push'
import { assertActiveSyncAccount } from './sessionGuard'
import { withAccountSyncLock } from './accountLock'

let inFlight: { accountId: string; promise: Promise<void> } | null = null

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Sync failed'
}

async function deferSync(accountId: string): Promise<void> {
  await db.syncMeta.update(accountId, { lastSyncError: null, lastSyncFailureKind: null })
  if (useSessionStore.getState().account?.id === accountId) useSyncStore.getState().setPending()
}

async function performSync(account: NonNullable<ReturnType<typeof useSessionStore.getState>['account']>): Promise<void> {
  useSyncStore.getState().setSyncing()
  await db.syncMeta.update(account.id, { lastSyncError: null, lastSyncFailureKind: null }).catch(() => undefined)

  try {
    const { accountId, deviceId } = await bootstrapSync(account)
    assertActiveSyncAccount(accountId)
    await pushOutbox(deviceId, accountId)
    assertActiveSyncAccount(accountId)

    const unresolvedBeforePull = await countUnresolvedOutboxForAccount(accountId)
    if (unresolvedBeforePull > 0) {
      const next = await getNextOutboxItem(accountId)
      if (next?.status === 'blocked') throw new SyncBlockedError(next, next.lastError ?? 'Mutation needs attention')
      await deferSync(accountId)
      return
    }

    const pullResult = await pullChanges(accountId)
    assertActiveSyncAccount(accountId)
    if (pullResult === 'deferred') {
      await deferSync(accountId)
      return
    }

    const syncedAt = new Date().toISOString()
    const clean = await db.transaction('rw', db.outbox, db.syncMeta, async () => {
      const clean = await countUnresolvedOutboxForAccount(accountId) === 0
      await db.syncMeta.update(accountId, {
        ...(clean ? { lastSyncedAt: syncedAt } : {}),
        lastSyncError: null,
        lastSyncFailureKind: null,
        bootstrapState: 'ready',
      })
      return clean
    })
    if (useSessionStore.getState().account?.id === accountId) {
      if (clean) useSyncStore.getState().setSynced(syncedAt)
      else useSyncStore.getState().setPending()
    }
  } catch (error) {
    const message = errorMessage(error)
    const failureKind = error instanceof SyncBlockedError
      ? 'blocked'
      : error instanceof ApiError && !error.retryable
        ? 'terminal'
        : 'retryable'
    await db.syncMeta.update(account.id, { lastSyncError: message, lastSyncFailureKind: failureKind }).catch(() => undefined)
    if (error instanceof ApiError && (error.status === 401 || error.code === 'session_expired' || error.code === 'auth_invalid')) {
      await db.accountCache.delete('current').catch(() => undefined)
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

/** Runs push before pull and returns the same promise to concurrent callers. */
export function runSync(): Promise<void> {
  const { status, account } = useSessionStore.getState()
  if (status !== 'authenticated' || !account) return Promise.resolve()

  if (inFlight) {
    if (inFlight.accountId === account.id) return inFlight.promise
    return inFlight.promise.catch(() => undefined).then(runSync)
  }

  const promise = withAccountSyncLock(account.id, () => performSync(account)).finally(() => {
    if (inFlight?.promise === promise) inFlight = null
  })
  inFlight = { accountId: account.id, promise }
  return promise
}
