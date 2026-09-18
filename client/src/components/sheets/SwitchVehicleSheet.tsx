import { Check, CarFront, Plus } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet'
import { useVehicles } from '@/hooks/useVehicles'
import { setLastVehicleId } from '@/lib/lastVehicle'
import { useSessionStore } from '@/stores/useSessionStore'
import { useUiStore } from '@/stores/useUiStore'

type SwitchVehicleSheetProps = {
  currentVehicleId?: string
}

function getDestination(pathname: string, vehicleId: string): string {
  const section = pathname.match(/\/v\/[^/]+\/(home|history|costs|log-entry)/)?.[1] ?? 'home'
  return `/v/${vehicleId}/${section}`
}

export function SwitchVehicleSheet({ currentVehicleId }: SwitchVehicleSheetProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const accountId = useSessionStore((state) => state.account?.id)
  const vehicles = useVehicles(accountId) ?? []
  const open = useUiStore((state) => state.vehicleSwitcherOpen)
  const close = useUiStore((state) => state.closeVehicleSwitcher)

  function selectVehicle(vehicleId: string) {
    if (!accountId) return
    setLastVehicleId(accountId, vehicleId)
    close()
    navigate(getDestination(location.pathname, vehicleId))
  }

  function addVehicle() {
    close()
    navigate('/onboarding/add-vehicle')
  }

  return (
    <Sheet open={open} onOpenChange={(nextOpen) => !nextOpen && close()}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className="gap-0 rounded-t-[24px] border-x-0 border-b-0 p-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] md:inset-x-0 md:mx-auto md:max-w-[600px] lg:inset-auto lg:left-1/2 lg:top-1/2 lg:w-[440px] lg:-translate-x-1/2 lg:-translate-y-1/2 lg:rounded-[20px] lg:border lg:p-[18px] lg:shadow-lg"
      >
        <div className="mx-auto mb-3.5 h-1 w-9 rounded-full bg-border lg:hidden" />
        <SheetTitle className="mx-0.5 mb-1 text-[15px] font-semibold tracking-[-0.01em]">{t('vehicle.switch')}</SheetTitle>
        <SheetDescription className="sr-only">{t('vehicle.switchDescription')}</SheetDescription>

        <div className="mt-2 max-h-[50dvh] overflow-y-auto rounded-2xl border border-border-subtle bg-card shadow-sm">
          {vehicles.length === 0 ? (
            <p className="px-4 py-5 text-center text-sm text-muted-foreground">{t('vehicle.none')}</p>
          ) : (
            vehicles.map((vehicle, index) => {
              const active = vehicle.id === currentVehicleId
              return (
                <button
                  key={vehicle.id}
                  type="button"
                  onClick={() => selectVehicle(vehicle.id)}
                  className={`flex min-h-16 w-full items-center gap-3 px-3.5 text-left transition hover:bg-background ${
                    index > 0 ? 'border-t border-border-subtle' : ''
                  }`}
                >
                  <span
                    className={`flex size-9 shrink-0 items-center justify-center rounded-[11px] border ${
                      active ? 'border-warn-border bg-warn-bg text-warn-fg' : 'border-border bg-muted text-muted-foreground'
                    }`}
                  >
                    <CarFront className="size-[18px]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{vehicle.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {vehicle.plateNumber || t('common.noPlate')}
                    </span>
                  </span>
                  {active ? (
                    <span className="flex items-center gap-1 text-xs font-medium text-warn-fg">
                      <Check className="size-3.5" />
                      {t('common.active')}
                    </span>
                  ) : null}
                </button>
              )
            })
          )}
        </div>

        <button
          type="button"
          onClick={addVehicle}
          className="mt-2.5 flex h-12 w-full items-center justify-center gap-2 rounded-xl border bg-card font-display text-sm font-medium shadow-[0_1px_1px_rgba(44,54,53,.025)] transition hover:border-foreground"
        >
          <Plus className="size-[18px]" />
          {t('vehicle.addTitle')}
        </button>
      </SheetContent>
    </Sheet>
  )
}
