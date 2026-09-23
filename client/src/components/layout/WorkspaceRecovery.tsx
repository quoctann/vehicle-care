import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { SyncStatusBadge } from './SyncStatusBadge'
import { resumeRestoreFromServer } from '@/sync/restore'
import { useSessionStore } from '@/stores/useSessionStore'

export function WorkspaceRecovery({ failed }: { failed: boolean }) {
  const { t } = useTranslation()
  const accountId = useSessionStore((state) => state.account?.id)

  useEffect(() => {
    if (!failed && accountId) void resumeRestoreFromServer(accountId).catch(() => undefined)
  }, [accountId, failed])

  return (
    <div className="grid min-h-dvh place-items-center bg-background p-6 text-center">
      <div className="max-w-md space-y-4 rounded-2xl border bg-card p-6 shadow-sm">
        <h1 className="text-xl font-semibold">{failed ? t('sync.restoreFailedTitle') : t('sync.restoringTitle')}</h1>
        <p className="text-sm leading-6 text-muted-foreground">
          {failed ? t('sync.restoreFailedDescription') : t('sync.restoringDescription')}
        </p>
        <div className="flex justify-center"><SyncStatusBadge /></div>
      </div>
    </div>
  )
}
