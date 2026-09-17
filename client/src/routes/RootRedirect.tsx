import { useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Navigate } from 'react-router-dom'
import { db } from '@/data/db'
import { useVehicles } from '@/hooks/useVehicles'
import { getLastVehicleId } from '@/lib/lastVehicle'
import { useSessionStore } from '@/stores/useSessionStore'
import { runSync } from '@/sync/syncOrchestrator'

/** "/" không phải 1 trang thật — luôn điều hướng sang xe dùng gần nhất hoặc màn thêm xe. */
export function RootRedirect() {
  const accountId = useSessionStore((state) => state.account?.id)
  const vehicles = useVehicles(accountId)
  const syncMetaQuery = useLiveQuery(
    async () => ({ accountId, meta: accountId ? await db.syncMeta.get(accountId) : undefined }),
    [accountId],
    { accountId: null, meta: undefined },
  )
  const syncMeta = syncMetaQuery.accountId === accountId ? syncMetaQuery.meta : undefined

  useEffect(() => {
    if (accountId && vehicles?.length === 0 && navigator.onLine && syncMetaQuery.accountId === accountId && syncMeta?.bootstrapState !== 'ready' && !syncMeta?.lastSyncError) {
      void runSync().catch(() => undefined)
    }
  }, [accountId, syncMeta, syncMetaQuery.accountId, vehicles])

  if (vehicles === undefined || !accountId || syncMetaQuery.accountId !== accountId) return null

  if (vehicles.length === 0 && navigator.onLine && syncMeta?.bootstrapState !== 'ready' && !syncMeta?.lastSyncError) {
    return <div className="grid min-h-dvh place-items-center text-sm text-muted-foreground">Syncing your garage...</div>
  }

  const lastVehicleId = getLastVehicleId(accountId)
  const vehicleId = vehicles.some((vehicle) => vehicle.id === lastVehicleId) ? lastVehicleId : vehicles[0]?.id
  return <Navigate to={vehicleId ? `/v/${vehicleId}/home` : '/onboarding/add-vehicle'} replace />
}
