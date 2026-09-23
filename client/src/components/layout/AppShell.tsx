import { useEffect } from 'react'
import { Plus, Settings } from 'lucide-react'
import { Link, Navigate, Outlet, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { SwitchVehicleSheet } from '@/components/sheets/SwitchVehicleSheet'
import { useVehicle, useVehicles } from '@/hooks/useVehicles'
import { setLastVehicleId, useLastVehicleId } from '@/lib/lastVehicle'
import { useSessionStore } from '@/stores/useSessionStore'
import { BottomTabBar } from './BottomTabBar'
import { SidebarNav } from './SidebarNav'
import { SyncStatusBadge } from './SyncStatusBadge'
import { WorkspaceRecovery } from './WorkspaceRecovery'
import { db } from '@/data/db'
import { useLiveQuery } from 'dexie-react-hooks'
import { VehicleSwitcher } from './VehicleSwitcher'

export function AppShell() {
  const { t } = useTranslation()
  const location = useLocation()
  const accountId = useSessionStore((state) => state.account?.id)
  const vehicles = useVehicles(accountId)
  const routeVehicleId = location.pathname.match(/^\/v\/([^/]+)\//)?.[1]
  const routeVehicleQuery = useVehicle(accountId, routeVehicleId)
  const routeVehicleKey = accountId && routeVehicleId ? `${accountId}:${routeVehicleId}` : null
  // Reactive read (KHÔNG `getLastVehicleId` gọi thẳng) — AppShell không sở hữu "xe đang
  // chọn", chỉ đọc lại; nếu 1 trang khác (vd SettingsPage) đổi giá trị này mà không điều
  // hướng đi đâu, AppShell vẫn phải tự re-render theo. Xem lesson learned ở lastVehicle.ts.
  const rememberedVehicleId = useLastVehicleId(accountId)
  const vehicleId = routeVehicleId ?? rememberedVehicleId ?? undefined
  const vehicle = routeVehicleId ? routeVehicleQuery.vehicle : vehicles?.find((candidate) => candidate.id === vehicleId)
  const isOnboarding = location.pathname.startsWith('/onboarding/')
  const isHome = location.pathname.endsWith('/home')
  const syncMeta = useLiveQuery(async () => (accountId ? await db.syncMeta.get(accountId) : undefined), [accountId])

  useEffect(() => {
    if (accountId && routeVehicleId && vehicle) setLastVehicleId(accountId, routeVehicleId)
  }, [accountId, routeVehicleId, vehicle])

  if (vehicles === undefined || routeVehicleQuery.queryKey !== routeVehicleKey) {
    return <div className="grid min-h-dvh place-items-center text-sm text-muted-foreground">{t('navigation.loadingGarage')}</div>
  }

  if (syncMeta?.operation === 'restoring' || syncMeta?.operation === 'restore_failed') {
    return <WorkspaceRecovery failed={syncMeta.operation === 'restore_failed'} />
  }

  if (routeVehicleId && !vehicle) {
    const fallback = vehicles[0]
    return <Navigate to={fallback ? `/v/${fallback.id}/home` : '/onboarding/add-vehicle'} replace />
  }

  if (isOnboarding) {
    return (
      <div className="min-h-dvh bg-background text-foreground">
        <div className="mx-auto flex max-w-md justify-end px-4 pt-4">
          <SyncStatusBadge />
        </div>
        <Outlet />
      </div>
    )
  }

  return (
    <div className="flex h-dvh overflow-hidden bg-background text-foreground">
      <aside className="hidden h-full w-60 shrink-0 flex-col border-r bg-card px-3 py-4 lg:flex">
        <VehicleSwitcher vehicle={vehicle} />
        {vehicleId ? (
          <Link
            to={`/v/${vehicleId}/log-entry`}
            className="mt-3 flex h-10 items-center justify-center gap-2 rounded-[10px] bg-primary font-display text-[13.5px] font-medium text-primary-foreground transition hover:bg-primary/90 active:translate-y-px"
          >
            <Plus className="size-[17px]" />
            {t('navigation.logService')}
          </Link>
        ) : null}
        <SidebarNav vehicleId={vehicleId} />
        <div className="flex-1" />
      </aside>

      <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {isHome ? (
          <header className="mx-auto flex w-full max-w-[600px] shrink-0 items-center gap-2.5 px-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))] lg:hidden">
            <VehicleSwitcher vehicle={vehicle} variant="header" />
            <SyncStatusBadge />
            <Link
              to="/settings"
              aria-label={t('navigation.settings')}
              className="flex size-9 shrink-0 items-center justify-center rounded-[10px] border bg-card shadow-[0_1px_1px_rgba(44,54,53,.025)] transition hover:border-foreground"
            >
              <Settings className="size-[19px]" />
            </Link>
          </header>
        ) : null}

        {/*
          overflow-hidden ở đây là CỐ Ý: shell không cuộn, mỗi page (Outlet) tự tạo
          vùng cuộn riêng của nó bằng `min-h-0 flex-1 overflow-y-auto` trên root
          element của page. Nếu 1 page mới không theo pattern này, nội dung dài hơn
          viewport sẽ bị CẮT CỤT và không cuộn được (đã từng là bug thật, xem
          SettingsPage/HistoryPage/CostsPage/HomePage để copy đúng pattern).
        */}
        <main
          className={`mx-auto flex min-h-0 w-full max-w-[600px] flex-1 flex-col overflow-hidden lg:max-w-[760px] lg:pt-6 ${
            isHome ? '' : 'pt-[max(1rem,env(safe-area-inset-top))] md:pt-[18px]'
          }`}
        >
          <Outlet />
        </main>
        <BottomTabBar vehicleId={vehicleId} />
      </section>

      <SwitchVehicleSheet currentVehicleId={vehicleId} />
    </div>
  )
}
