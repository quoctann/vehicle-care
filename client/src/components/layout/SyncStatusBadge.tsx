import { AlertCircle, Check, CloudOff, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { useOutboxPendingCount } from '@/hooks/useOutboxPendingCount'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { runSync } from '@/sync/syncOrchestrator'
import { useSessionStore } from '@/stores/useSessionStore'
import { useSyncStore } from '@/stores/useSyncStore'
import { formatTime } from '@/lib/formatters'

export function SyncStatusBadge() {
  const { t } = useTranslation()
  const authenticated = useSessionStore((state) => state.status === 'authenticated')
  const timezone = useSessionStore((state) => state.account?.timezone)
  const pendingCount = useOutboxPendingCount()
  const online = useOnlineStatus()
  const status = useSyncStore((state) => state.status)
  const lastSyncedAt = useSyncStore((state) => state.lastSyncedAt)
  const lastError = useSyncStore((state) => state.lastError)

  if (!authenticated) return null

  let label = t('sync.now')
  let icon = <RefreshCw />
  if (status === 'syncing') {
    label = t('sync.syncing')
    icon = <RefreshCw className="animate-spin" />
  } else if (!online) {
    label = t('sync.offline')
    icon = <CloudOff />
  } else if (status === 'error') {
    label = t('sync.failed')
    icon = <AlertCircle />
  } else if (status === 'synced' && lastSyncedAt) {
    label = t('sync.syncedAt', { time: formatTime(lastSyncedAt, timezone) })
    icon = <Check />
  }

  if (pendingCount > 0) label += ` · ${t('sync.pending', { count: pendingCount })}`

  return (
    <Button
      type="button"
      variant={status === 'error' ? 'destructive' : 'outline'}
      size="sm"
      className="max-w-[11rem] shrink-0"
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
