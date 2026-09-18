import { Fuel, Wrench } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export type LogEntryType = 'fuel' | 'service'

type EntryTypeSelectorProps = {
  value: LogEntryType
  onChange: (value: LogEntryType) => void
}

export function EntryTypeSelector({ value, onChange }: EntryTypeSelectorProps) {
  const { t } = useTranslation()
  const entryTypes = [
    { value: 'fuel', label: t('logEntry.fuel'), description: t('logEntry.fuelDescription'), icon: Fuel },
    { value: 'service', label: t('logEntry.service'), description: t('logEntry.serviceDescription'), icon: Wrench },
  ] as const
  return (
    <fieldset>
      <legend className="mb-2 px-0.5 text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
        {t('logEntry.entryType')}
      </legend>
      <div className="grid grid-cols-2 gap-2">
        {entryTypes.map((entryType) => {
          const Icon = entryType.icon
          const selected = value === entryType.value

          return (
            <button
              key={entryType.value}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(entryType.value)}
              className={`flex min-h-20 items-center gap-3 rounded-2xl border bg-card px-4 text-left transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none ${
                selected
                  ? 'border-foreground shadow-sm ring-2 ring-background'
                  : 'border-border-subtle text-muted-foreground hover:border-border hover:text-foreground'
              }`}
            >
              <span className={`grid size-9 shrink-0 place-items-center rounded-xl ${selected ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
                <Icon className="size-4.5" aria-hidden="true" />
              </span>
              <span>
                <span className="block text-sm font-semibold text-foreground">{entryType.label}</span>
                <span className="mt-0.5 block text-xs">{entryType.description}</span>
              </span>
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}
