import { Fuel, Wrench } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { HistoryEntry } from '@/data/queries/historyQueries'
import { formatVnd } from '@/lib/currency'
import { formatNumber, UI_LOCALE } from '@/lib/formatters'

type RecentlyLoggedSectionProps = {
  entries: HistoryEntry[]
  vehicleId: string
  timezone: string
}

export function RecentlyLoggedSection({ entries, vehicleId, timezone }: RecentlyLoggedSectionProps) {
  const { t } = useTranslation()
  const recentEntries = entries.slice(0, 2)
  const dateFormatter = new Intl.DateTimeFormat(UI_LOCALE, {
    day: 'numeric',
    month: 'short',
    timeZone: timezone,
  })

  return (
    <section>
      <div className="mx-0.5 mb-2 mt-5 flex items-baseline justify-between">
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">{t('home.recentlyLogged')}</h2>
        <Link to={`/v/${vehicleId}/history`} className="text-[11px] font-medium text-primary hover:underline">
          {t('home.seeAll')}
        </Link>
      </div>
      <div className="overflow-hidden rounded-2xl border border-border-subtle bg-card shadow-sm">
        {recentEntries.length === 0 ? (
          <p className="px-4 py-5 text-center text-sm text-muted-foreground">{t('home.noRecentEntries')}</p>
        ) : (
          recentEntries.map((entry, index) => {
            const Icon = entry.kind === 'fuel' ? Fuel : Wrench
            return (
              <div
                key={`${entry.kind}-${entry.id}`}
                className={`flex min-h-[58px] items-center gap-3 px-3.5 py-2.5 ${index > 0 ? 'border-t border-border-subtle' : ''}`}
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-[11px] border bg-muted text-muted-foreground">
                  <Icon className="size-[18px]" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {entry.kind === 'fuel'
                      ? entry.liters == null
                        ? t('history.fuel')
                        : t('history.fuelWithLiters', { value: formatNumber(entry.liters) })
                      : entry.title || t('history.unknownService')}
                  </span>
                  <span className="block truncate text-[11.5px] text-muted-foreground">
                    {dateFormatter.format(new Date(entry.occurredAt))}
                    {entry.note ? ` · ${entry.note}` : ''}
                  </span>
                </span>
                {entry.costVnd != null ? <span className="text-xs font-medium">{formatVnd(entry.costVnd)}</span> : null}
              </div>
            )
          })
        )}
      </div>
    </section>
  )
}
