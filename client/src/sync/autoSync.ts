import { db } from '@/data/db'
import { AUTO_SYNC_INTERVAL_MS } from '@/domain/constants'
import { useSessionStore } from '@/stores/useSessionStore'
import { runSync } from './syncOrchestrator'

/** Starts foreground auto-sync and returns a Strict-Mode-safe cleanup function. */
export function startAutoSync(): () => void {
  let stopped = false
  let checkId = 0
  let timer: ReturnType<typeof setTimeout> | null = null

  const schedule = (delay: number) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void check(), delay)
  }

  const check = async () => {
    const currentCheck = ++checkId
    if (timer) {
      clearTimeout(timer)
      timer = null
    }

    const { status, account } = useSessionStore.getState()
    if (
      stopped ||
      status !== 'authenticated' ||
      !account ||
      typeof navigator === 'undefined' ||
      !navigator.onLine ||
      typeof document === 'undefined' ||
      document.visibilityState !== 'visible'
    ) {
      return
    }

    const meta = await db.syncMeta.get(account.id)
    if (stopped || currentCheck !== checkId) return

    // A failed sync requires an explicit user action. This prevents foreground
    // events from retrying a broken queue forever.
    if (meta?.lastSyncError) return

    const lastSyncMs = meta?.lastSyncedAt ? Date.parse(meta.lastSyncedAt) : Number.NaN
    const elapsed = Number.isFinite(lastSyncMs) ? Date.now() - lastSyncMs : Number.POSITIVE_INFINITY
    if (elapsed > AUTO_SYNC_INTERVAL_MS) {
      await runSync().catch(() => undefined)
      if (!stopped && currentCheck === checkId) schedule(AUTO_SYNC_INTERVAL_MS + 1)
      return
    }

    schedule(AUTO_SYNC_INTERVAL_MS - elapsed + 1)
  }

  const handleWake = () => void check()
  window.addEventListener('online', handleWake)
  document.addEventListener('visibilitychange', handleWake)
  const unsubscribe = useSessionStore.subscribe(handleWake)
  void check()

  return () => {
    stopped = true
    checkId += 1
    if (timer) clearTimeout(timer)
    window.removeEventListener('online', handleWake)
    document.removeEventListener('visibilitychange', handleWake)
    unsubscribe()
  }
}
