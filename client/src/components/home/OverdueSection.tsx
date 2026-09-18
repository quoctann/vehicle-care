import type { ReminderWithStatus } from '@/data/queries/reminderQueries'
import { useTranslation } from 'react-i18next'
import { ReminderListItem } from './ReminderListItem'

type OverdueSectionProps = {
  reminders: ReminderWithStatus[]
  vehicleId: string
}

export function OverdueSection({ reminders, vehicleId }: OverdueSectionProps) {
  const { t } = useTranslation()
  if (reminders.length === 0) return null

  return (
    <section>
      <h2 className="mx-0.5 mb-2 mt-5 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
        {t('home.overdue')}
      </h2>
      <div className="overflow-hidden rounded-2xl border border-border-subtle bg-card shadow-sm">
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
