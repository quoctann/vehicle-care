import { ChevronDown } from 'lucide-react'
import type { Vehicle } from '@/domain/types'
import { useTranslation } from 'react-i18next'
import { useUiStore } from '@/stores/useUiStore'

type VehicleSwitcherProps = {
  vehicle?: Vehicle
  variant?: 'sidebar' | 'header'
}

function initials(name: string): string {
  const value = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
  return value || 'V'
}

export function VehicleSwitcher({ vehicle, variant = 'sidebar' }: VehicleSwitcherProps) {
  const { t } = useTranslation()
  const openVehicleSwitcher = useUiStore((state) => state.openVehicleSwitcher)
  const avatarSize = variant === 'header' ? 'size-10 rounded-xl text-[13px]' : 'size-9 rounded-[11px] text-xs'

  return (
    <button
      type="button"
      onClick={openVehicleSwitcher}
      className={`flex min-w-0 items-center gap-2.5 text-left ${
        variant === 'header' ? 'flex-1' : 'w-full rounded-xl p-2 transition hover:bg-background'
      }`}
      aria-label={t('vehicle.switch')}
    >
      <span
        className={`flex shrink-0 items-center justify-center border border-warn-border bg-warn-bg font-bold tracking-[-0.02em] text-warn-fg ${avatarSize}`}
      >
        {initials(vehicle?.name ?? 'V')}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1">
          <span className={`${variant === 'header' ? 'text-[14.5px]' : 'text-[13.5px]'} truncate font-semibold leading-tight`}>
            {vehicle?.name ?? t('vehicle.select')}
          </span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </span>
        <span className="block truncate text-xs leading-[1.35] text-muted-foreground">
          {vehicle?.plateNumber || t('common.noPlate')}
        </span>
      </span>
    </button>
  )
}
