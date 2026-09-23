import { useState } from 'react'
import { AlertCircle, Check, CloudOff, RefreshCw, Wrench } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { listOutboxForAccount, repairBlockedMutation } from '@/data/outbox'
import { useOutboxState } from '@/hooks/useOutboxPendingCount'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { runSync } from '@/sync/syncOrchestrator'
import { restoreFromServer } from '@/sync/restore'
import { useSessionStore } from '@/stores/useSessionStore'
import { useSyncStore } from '@/stores/useSyncStore'
import { formatTime } from '@/lib/formatters'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/data/db'

export function SyncStatusBadge() {
  const { t } = useTranslation()
  const authenticated = useSessionStore((state) => state.status === 'authenticated')
  const accountId = useSessionStore((state) => state.account?.id)
  const timezone = useSessionStore((state) => state.account?.timezone)
  const outboxState = useOutboxState(accountId)
  const outbox = useLiveQuery(() => (accountId ? listOutboxForAccount(accountId) : Promise.resolve([])), [accountId], []) ?? []
  const syncMeta = useLiveQuery(async () => (accountId ? await db.syncMeta.get(accountId) : undefined), [accountId])
  const online = useOnlineStatus()
  const status = useSyncStore((state) => state.status)
  const lastSyncedAt = useSyncStore((state) => state.lastSyncedAt)
  const lastError = useSyncStore((state) => state.lastError)
  const [recoveryOpen, setRecoveryOpen] = useState(false)
  const blocked = outbox.filter((item) => item.status === 'blocked')
  const firstBlocked = blocked[0]
  const [draft, setDraft] = useState('')
  const [draftMutationId, setDraftMutationId] = useState<string | null>(null)
  const displayedDraft = firstBlocked && draftMutationId === firstBlocked.mutationId
    ? draft
    : firstBlocked
      ? JSON.stringify(firstBlocked.payload, null, 2)
      : ''

  if (!authenticated) return null

  let label = t('sync.now')
  let icon = <RefreshCw />
  if (status === 'syncing') {
    label = t('sync.syncing')
    icon = <RefreshCw className="animate-spin" />
  } else if (!online) {
    label = t('sync.offline')
    icon = <CloudOff />
  } else if (status === 'blocked' || outboxState.blocked > 0) {
    label = t('sync.blocked', { count: outboxState.blocked })
    icon = <AlertCircle />
  } else if (status === 'retryable' || outboxState.retryable > 0) {
    label = t('sync.retry')
    icon = <RefreshCw />
  } else if (status === 'error') {
    label = t('sync.failed')
    icon = <AlertCircle />
  } else if (status === 'synced' && lastSyncedAt) {
    label = t('sync.syncedAt', { time: formatTime(lastSyncedAt, timezone) })
    icon = <Check />
  }

  if (outboxState.pending > 0 && status !== 'blocked' && status !== 'retryable') label = t('sync.pending', { count: outboxState.pending })

  const canRetry = online && outboxState.blocked === 0 && (status === 'retryable' || outboxState.retryable > 0)
  const openRecovery = syncMeta?.operation === 'restore_failed' || status === 'blocked' || outboxState.blocked > 0 || (status === 'error' && !canRetry)

  async function handleRepair() {
    if (!firstBlocked || !accountId) return
    try {
      const payload = JSON.parse(displayedDraft) as Record<string, unknown>
      await repairBlockedMutation(firstBlocked.mutationId, payload)
      useSyncStore.getState().setPending()
      setRecoveryOpen(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.unknownError'))
    }
  }

  async function handleRestore() {
    if (!accountId || !window.confirm(t('sync.restoreConfirm'))) return
    try {
      await restoreFromServer(accountId)
      setRecoveryOpen(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.unknownError'))
    }
  }

  return (
    <>
    <Button
      type="button"
      variant={status === 'error' ? 'destructive' : 'outline'}
      size="sm"
      className="max-w-[11rem] shrink-0"
      disabled={!online || status === 'syncing' || status === 'restoring'}
      onClick={() => {
        if (openRecovery) setRecoveryOpen(true)
        else void runSync().catch(() => undefined)
      }}
      title={lastError ?? label}
      aria-label={lastError ? `${label}: ${lastError}` : label}
      aria-live="polite"
    >
      {icon}
      <span className="truncate">{label}</span>
    </Button>
    <Button
      type="button"
      variant="ghost"
      size="icon"
      disabled={status === 'syncing' || status === 'restoring'}
      onClick={() => setRecoveryOpen(true)}
      title={t('sync.recoveryTitle')}
      aria-label={t('sync.recoveryTitle')}
    >
      <Wrench className="size-4" />
    </Button>
    <Dialog open={recoveryOpen} onOpenChange={setRecoveryOpen}>
      <DialogContent className="max-h-[min(90dvh,42rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('sync.recoveryTitle')}</DialogTitle>
          <DialogDescription>{t('sync.recoveryDescription')}</DialogDescription>
        </DialogHeader>
        {firstBlocked ? (
          <div className="space-y-3">
            <div className="rounded-lg border bg-muted/30 p-3 text-xs">
              <p className="font-medium">{firstBlocked.entityType} · {firstBlocked.entityId}</p>
              <p className="mt-1 text-muted-foreground">{firstBlocked.lastError ?? t('sync.blockedReason')}</p>
            </div>
            <Textarea
              value={displayedDraft}
              onChange={(event) => {
                setDraftMutationId(firstBlocked.mutationId)
                setDraft(event.target.value)
              }}
              className="min-h-40 font-mono text-xs"
              aria-label={t('sync.repairPayload')}
            />
            <Button type="button" className="w-full" onClick={() => void handleRepair()}>{t('sync.repair')}</Button>
          </div>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={!online || status === 'restoring'} onClick={() => void handleRestore()}>
            {t('sync.restoreFromServer')}
          </Button>
          {!firstBlocked && canRetry ? <Button type="button" onClick={() => { setRecoveryOpen(false); void runSync().catch(() => undefined) }}>{t('sync.retry')}</Button> : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  )
}
