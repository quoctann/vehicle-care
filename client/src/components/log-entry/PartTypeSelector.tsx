import {
  BatteryFull,
  CircleDot,
  Cog,
  Disc,
  Droplet,
  Link2,
  Wind,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { resolvePartTypeDisplay, type PartTypeIconKey } from '@/domain/partType'
import type { PartType } from '@/domain/types'

type PartTypeSelectorProps = {
  partTypes: PartType[]
  value: string | null
  onChange: (partTypeId: string) => void
}

const icons: Record<PartTypeIconKey, LucideIcon> = {
  engine_oil: Droplet,
  front_tire: CircleDot,
  rear_tire: CircleDot,
  front_brake_pad: Disc,
  rear_brake_pad: Disc,
  spark_plug: Zap,
  air_filter: Wind,
  drive_belt: Link2,
  chain_sprocket_set: Cog,
  battery: BatteryFull,
  unknown: Wrench,
}

export function PartTypeSelector({ partTypes, value, onChange }: PartTypeSelectorProps) {
  const { t } = useTranslation()
  return (
    <fieldset>
      <legend className="mb-2 px-0.5 text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
        {t('logEntry.partServiced')}
      </legend>
      {partTypes.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card px-4 py-5 text-center text-sm text-muted-foreground">
          {t('logEntry.noPartTypes')}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {partTypes.map((partType) => {
            const display = resolvePartTypeDisplay(partType.code, partTypes)
            const Icon = icons[display.icon]
            const selected = value === partType.id

            return (
              <button
                key={partType.id}
                type="button"
                aria-pressed={selected}
                onClick={() => onChange(partType.id)}
                className={`flex min-h-24 flex-col items-start justify-between rounded-2xl border bg-card p-3 text-left transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none ${
                  selected
                    ? 'border-foreground shadow-sm ring-2 ring-background'
                    : 'border-border-subtle text-muted-foreground hover:border-border hover:text-foreground'
                }`}
              >
                <Icon className={`size-5 ${selected ? 'text-primary' : ''}`} aria-hidden="true" />
                <span className="mt-3 text-xs font-semibold leading-tight text-foreground">{display.displayName}</span>
              </button>
            )
          })}
        </div>
      )}
    </fieldset>
  )
}
