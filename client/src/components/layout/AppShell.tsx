import { useEffect } from 'react'
import { Plus, Settings } from 'lucide-react'
import { Link, Navigate, Outlet, useLocation } from 'react-router-dom'
import { SwitchVehicleSheet } from '@/components/sheets/SwitchVehicleSheet'
import { useVehicle, useVehicles } from '@/hooks/useVehicles'
import { getLastVehicleId, setLastVehicleId } from '@/lib/lastVehicle'
import { useSessionStore } from '@/stores/useSessionStore'
import { BottomTabBar } from './BottomTabBar'
import { SidebarNav } from './SidebarNav'
import { SyncStatusBadge } from './SyncStatusBadge'
import { VehicleSwitcher } from './VehicleSwitcher'

export function AppShell() {
  const location = useLocation()
  const accountId = useSessionStore((state) => state.account?.id)
  const vehicles = useVehicles(accountId)
  const routeVehicleId = location.pathname.match(/^\/v\/([^/]+)\//)?.[1]
  const routeVehicleQuery = useVehicle(accountId, routeVehicleId)
  const routeVehicleKey = accountId && routeVehicleId ? `${accountId}:${routeVehicleId}` : null
  const rememberedVehicleId = accountId ? getLastVehicleId(accountId) : null
  const vehicleId = routeVehicleId ?? rememberedVehicleId ?? undefined
  const vehicle = routeVehicleId ? routeVehicleQuery.vehicle : vehicles?.find((candidate) => candidate.id === vehicleId)
  const isOnboarding = location.pathname.startsWith('/onboarding/')
  const isHome = location.pathname.endsWith('/home')

  useEffect(() => {
    if (accountId && routeVehicleId && vehicle) setLastVehicleId(accountId, routeVehicleId)
  }, [accountId, routeVehicleId, vehicle])

  if (vehicles === undefined || routeVehicleQuery.queryKey !== routeVehicleKey) {
    return <div className="grid min-h-dvh place-items-center text-sm text-muted-foreground">Loading your garage...</div>
  }

  if (routeVehicleId && !vehicle) {
    const fallback = vehicles[0]
    return <Navigate to={fallback ? `/v/${fallback.id}/home` : '/onboarding/add-vehicle'} replace />
  }

  if (isOnboarding) {
    return (
      <div className="min-h-dvh bg-background text-foreground">
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
            className="mt-3 flex h-10 items-center justify-center gap-2 rounded-[10px] bg-gradient-to-b from-[#2c2c2c] to-[#141414] font-display text-[13.5px] font-medium text-white transition active:translate-y-px"
          >
            <Plus className="size-[17px]" />
            Log service
          </Link>
        ) : null}
        <SidebarNav vehicleId={vehicleId} />
        <div className="flex-1" />
        <div className="[&>button]:static [&>button]:h-9 [&>button]:w-full [&>button]:max-w-none [&>button]:justify-start [&>button]:border-0 [&>button]:bg-transparent [&>button]:px-2.5 [&>button]:shadow-none">
          <SyncStatusBadge />
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {isHome ? (
          <header className="mx-auto flex w-full max-w-[600px] shrink-0 items-center gap-2.5 px-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))] lg:hidden">
            <VehicleSwitcher vehicle={vehicle} variant="header" />
            <Link
              to="/settings"
              aria-label="Settings"
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
