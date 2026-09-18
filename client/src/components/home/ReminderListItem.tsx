import {
  Battery,
  CircleDot,
  Droplet,
  Settings,
  Wind,
  Wrench,
  Zap,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { ReminderWithStatus } from '@/data/queries/reminderQueries'
import { formatNumber } from '@/lib/formatters'

type ReminderListItemProps = {
  reminder: ReminderWithStatus
  to: string
  divider?: boolean
}

function ReminderIcon({ code }: { code: string }) {
  const className = 'size-[18px]'
  if (code === 'engine_oil') return <Droplet className={className} />
  if (code === 'front_tire' || code === 'rear_tire') return <CircleDot className={className} />
  if (code === 'battery') return <Battery className={className} />
  if (code === 'spark_plug') return <Zap className={className} />
  if (code === 'air_filter') return <Wind className={className} />
  if (code === 'drive_belt' || code === 'chain_sprocket_set') return <Settings className={className} />
  return <Wrench className={className} />
}

function intervalLabel(reminder: ReminderWithStatus, t: ReturnType<typeof useTranslation>['t']): string {
  const parts: string[] = []
  if (reminder.config.intervalKm != null) parts.push(t('home.everyKm', { value: formatNumber(reminder.config.intervalKm) }))
  if (reminder.config.intervalDays != null) parts.push(t('home.everyDays', { value: formatNumber(reminder.config.intervalDays) }))
  return parts.join(' · ')
}

function remainingLabel(reminder: ReminderWithStatus, t: ReturnType<typeof useTranslation>['t']): string {
  const { result } = reminder
  if (result.status === 'overdue') {
    if (result.km && result.km.remaining <= 0) {
      return t('home.overdueKm', { value: formatNumber(Math.abs(result.km.remaining)) })
    }
    if (result.days && result.days.remainingDays <= 0) {
      return t('home.overdueDays', { value: formatNumber(Math.abs(result.days.remainingDays)) })
    }
  }
  if (result.km) return t('home.remainingKm', { value: formatNumber(Math.max(0, result.km.remaining)) })
  if (result.days) return t('home.remainingDays', { value: formatNumber(Math.max(0, result.days.remainingDays)) })
  return t('home.needsData')
}

export function ReminderListItem({ reminder, to, divider = false }: ReminderListItemProps) {
  const { t } = useTranslation()
  const trailing = remainingLabel(reminder, t)
  const ratios = [reminder.result.km?.ratioUsed, reminder.result.days?.ratioUsed].filter(
    (ratio): ratio is number => ratio != null,
  )
  const progress = ratios.length === 0 ? 0 : Math.min(100, Math.max(...ratios) * 100)
  const overdue = reminder.result.status === 'overdue'

  return (
    <Link
      to={to}
      className={`group relative flex min-h-[68px] items-center gap-3 px-3.5 py-2.5 transition hover:bg-background ${
        divider ? 'border-t border-border-subtle' : ''
      }`}
    >
      <span
        className={`flex size-9 shrink-0 items-center justify-center rounded-[11px] border ${
          overdue ? 'border-destructive/30 bg-destructive/10 text-destructive' : 'border-warn-border bg-warn-bg text-warn-fg'
        }`}
      >
        <ReminderIcon code={reminder.partType.code} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium tracking-[-0.01em]">{reminder.partType.displayName}</span>
        <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">{intervalLabel(reminder, t)}</span>
        <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-muted">
          <span
            className={`block h-full rounded-full ${overdue ? 'bg-destructive' : 'bg-warn-solid'}`}
            style={{ width: `${progress}%` }}
          />
        </span>
      </span>
      <span className={`shrink-0 text-right ${overdue ? 'text-destructive' : 'text-foreground'}`}>
        <span className="block text-xs font-semibold">{trailing}</span>
      </span>
    </Link>
  )
}
