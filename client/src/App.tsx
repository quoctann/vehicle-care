import { useEffect } from 'react'
import { BrowserRouter } from 'react-router-dom'
import { ThemeColorSync } from '@/components/theme/ThemeColorSync'
import { Toaster } from '@/components/ui/sonner'
import { db } from '@/data/db'
import { AppRouter } from '@/routes/router'
import { startAutoSync } from '@/sync/autoSync'
import { useSessionStore } from '@/stores/useSessionStore'
import { useSyncStore } from '@/stores/useSyncStore'

export default function App() {
  const hydrate = useSessionStore((s) => s.hydrate)
  const accountId = useSessionStore((s) => s.account?.id)

  useEffect(() => {
    // Cookie session (nếu có) tự đính kèm — không cần đọc gì từ local storage.
    void hydrate()
  }, [hydrate])

  useEffect(() => {
    let cancelled = false
    useSyncStore.setState({ status: 'idle', lastSyncedAt: null, lastError: null })
    if (!accountId) return

    void db.syncMeta.get(accountId).then((meta) => {
      if (cancelled || useSessionStore.getState().account?.id !== accountId || useSyncStore.getState().status === 'syncing') return
      useSyncStore.setState({
        status: meta?.lastSyncError ? 'error' : meta?.lastSyncedAt ? 'synced' : 'idle',
        lastSyncedAt: meta?.lastSyncedAt ?? null,
        lastError: meta?.lastSyncError ?? null,
      })
    })

    return () => {
      cancelled = true
    }
  }, [accountId])

  useEffect(() => startAutoSync(), [])

  return (
    <BrowserRouter>
      <ThemeColorSync />
      <AppRouter />
      <Toaster position="top-center" />
    </BrowserRouter>
  )
}
