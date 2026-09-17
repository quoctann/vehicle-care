import type { ReminderWithStatus } from '@/data/queries/reminderQueries'
import { ReminderListItem } from './ReminderListItem'

type OverdueSectionProps = {
  reminders: ReminderWithStatus[]
  vehicleId: string
}

export function OverdueSection({ reminders, vehicleId }: OverdueSectionProps) {
  if (reminders.length === 0) return null

  return (
    <section>
      <h2 className="mx-0.5 mb-2 mt-5 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
        Overdue
      </h2>
      <div className="overflow-hidden rounded-2xl border border-border-subtle bg-card shadow-[0_1px_1px_rgba(44,54,53,.025),inset_0_0_0_2px_#fff]">
        {reminders.map((reminder, index) => (
          <ReminderListItem
            key={reminder.config.id}
            reminder={reminder}
            to={`/v/${vehicleId}/log-entry`}
            divider={index > 0}
          />
        ))}
      </div>
    </section>
  )
}
