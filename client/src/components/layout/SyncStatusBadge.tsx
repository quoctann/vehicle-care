import { AlertCircle, Check, CloudOff, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useOutboxPendingCount } from '@/hooks/useOutboxPendingCount'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { runSync } from '@/sync/syncOrchestrator'
import { useSessionStore } from '@/stores/useSessionStore'
import { useSyncStore } from '@/stores/useSyncStore'

export function SyncStatusBadge() {
  const authenticated = useSessionStore((state) => state.status === 'authenticated')
  const pendingCount = useOutboxPendingCount()
  const online = useOnlineStatus()
  const status = useSyncStore((state) => state.status)
  const lastSyncedAt = useSyncStore((state) => state.lastSyncedAt)
  const lastError = useSyncStore((state) => state.lastError)

  if (!authenticated) return null

  let label = 'Sync now'
  let icon = <RefreshCw />
  if (status === 'syncing') {
    label = 'Syncing'
    icon = <RefreshCw className="animate-spin" />
  } else if (!online) {
    label = 'Offline'
    icon = <CloudOff />
  } else if (status === 'error') {
    label = 'Sync failed'
    icon = <AlertCircle />
  } else if (status === 'synced' && lastSyncedAt) {
    label = `Synced ${new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date(lastSyncedAt))}`
    icon = <Check />
  }

  if (pendingCount > 0) label += ` · ${pendingCount} pending`

  return (
    <Button
      type="button"
      variant={status === 'error' ? 'destructive' : 'outline'}
      size="sm"
      className="fixed top-3 right-3 z-40 max-w-[calc(100vw-1.5rem)] bg-background/90 shadow-sm backdrop-blur"
      disabled={!online || status === 'syncing'}
      onClick={() => void runSync().catch(() => undefined)}
      title={lastError ?? label}
      aria-label={lastError ? `${label}: ${lastError}` : label}
      aria-live="polite"
    >
      {icon}
      <span className="truncate">{label}</span>
    </Button>
  )
}
