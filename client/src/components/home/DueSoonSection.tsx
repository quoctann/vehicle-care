import type { ReminderWithStatus } from '@/data/queries/reminderQueries'
import { useTranslation } from 'react-i18next'
import { ReminderListItem } from './ReminderListItem'

type DueSoonSectionProps = {
  reminders: ReminderWithStatus[]
  vehicleId: string
}

export function DueSoonSection({ reminders, vehicleId }: DueSoonSectionProps) {
  const { t } = useTranslation()
  return (
    <section>
      <div className="mx-0.5 mb-2 mt-5 flex items-baseline justify-between">
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">{t('home.dueSoon')}</h2>
        <span className="text-[11px] text-muted-foreground">
          {t('home.itemCount', { count: reminders.length })}
        </span>
      </div>
      <div className="overflow-hidden rounded-2xl border border-border-subtle bg-card shadow-sm">
        {reminders.length === 0 ? (
          <p className="px-4 py-5 text-center text-sm text-muted-foreground">{t('home.nothingDueSoon')}</p>
        ) : (
          reminders.map((reminder, index) => (
            <ReminderListItem
              key={reminder.config.id}
              reminder={reminder}
              to={`/v/${vehicleId}/log-entry`}
              divider={index > 0}
            />
          ))
        )}
      </div>
    </section>
  )
}
