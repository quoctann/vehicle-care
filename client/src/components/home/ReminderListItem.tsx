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
import type { ReminderWithStatus } from '@/data/queries/reminderQueries'

type ReminderListItemProps = {
  reminder: ReminderWithStatus
  to: string
  divider?: boolean
}

const numberFormatter = new Intl.NumberFormat('en-US')

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

function intervalLabel(reminder: ReminderWithStatus): string {
  const parts: string[] = []
  if (reminder.config.intervalKm != null) parts.push(`Every ${numberFormatter.format(reminder.config.intervalKm)} km`)
  if (reminder.config.intervalDays != null) parts.push(`Every ${numberFormatter.format(reminder.config.intervalDays)} days`)
  return parts.join(' · ')
}

function remainingLabel(reminder: ReminderWithStatus): { value: string; caption: string } {
  const { result } = reminder
  if (result.status === 'overdue') {
    if (result.km && result.km.remaining <= 0) {
      return { value: `${numberFormatter.format(Math.abs(result.km.remaining))} km`, caption: 'overdue' }
    }
    if (result.days && result.days.remainingDays <= 0) {
      return { value: `${numberFormatter.format(Math.abs(result.days.remainingDays))} days`, caption: 'overdue' }
    }
  }
  if (result.km) return { value: `${numberFormatter.format(Math.max(0, result.km.remaining))} km`, caption: 'to go' }
  if (result.days) return { value: `${numberFormatter.format(Math.max(0, result.days.remainingDays))} days`, caption: 'to go' }
  return { value: 'Needs data', caption: '' }
}

export function ReminderListItem({ reminder, to, divider = false }: ReminderListItemProps) {
  const trailing = remainingLabel(reminder)
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
          overdue ? 'border-red-200 bg-red-50 text-red-700' : 'border-warn-border bg-warn-bg text-warn-fg'
        }`}
      >
        <ReminderIcon code={reminder.partType.code} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium tracking-[-0.01em]">{reminder.partType.displayName}</span>
        <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">{intervalLabel(reminder)}</span>
        <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-muted">
          <span
            className={`block h-full rounded-full ${overdue ? 'bg-red-500' : 'bg-[#d69a23]'}`}
            style={{ width: `${progress}%` }}
          />
        </span>
      </span>
      <span className={`shrink-0 text-right ${overdue ? 'text-red-700' : 'text-foreground'}`}>
        <span className="block text-xs font-semibold">{trailing.value}</span>
        {trailing.caption ? <span className="block text-[10.5px] text-muted-foreground">{trailing.caption}</span> : null}
      </span>
    </Link>
  )
}
