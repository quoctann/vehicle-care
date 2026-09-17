import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { DueSoonSection } from '@/components/home/DueSoonSection'
import { OdometerCard } from '@/components/home/OdometerCard'
import { OverdueSection } from '@/components/home/OverdueSection'
import { RecentlyLoggedSection } from '@/components/home/RecentlyLoggedSection'
import { UpdateOdometerSheet } from '@/components/sheets/UpdateOdometerSheet'
import { useHistoryEntries } from '@/hooks/useHistory'
import { useCurrentOdometer, useReminderStatuses } from '@/hooks/useReminders'
import { useSessionStore } from '@/stores/useSessionStore'

export function HomePage() {
  const { vehicleId } = useParams()
  const account = useSessionStore((state) => state.account)
  const timezone = account?.timezone ?? 'UTC'
  const currentOdometerKm = useCurrentOdometer(account?.id, vehicleId)
  const reminders = useReminderStatuses(account?.id, vehicleId, timezone)
  const historyEntries = useHistoryEntries(account?.id, vehicleId)
  const [odometerOpen, setOdometerOpen] = useState(false)

  if (!vehicleId) {
    return <div className="p-6 text-sm text-muted-foreground">Choose a vehicle to see its dashboard.</div>
  }

  const overdue = reminders.filter((reminder) => reminder.result.status === 'overdue')
  const dueSoon = reminders.filter((reminder) => reminder.result.status === 'due_soon')

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <h1 className="hidden shrink-0 px-4 pb-3 text-2xl font-bold tracking-[-0.03em] lg:block">Home</h1>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        <OdometerCard odometerKm={currentOdometerKm} onUpdate={() => setOdometerOpen(true)} />
        <OverdueSection reminders={overdue} vehicleId={vehicleId} />
        <DueSoonSection reminders={dueSoon} vehicleId={vehicleId} />
        <RecentlyLoggedSection entries={historyEntries} vehicleId={vehicleId} timezone={timezone} />
      </div>

      <div className="shrink-0 px-4 pb-2 pt-3 lg:hidden">
        <Link
          to={`/v/${vehicleId}/log-entry`}
          className="flex h-12 items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-[#2c2c2c] to-[#141414] font-display text-sm font-medium text-white transition active:translate-y-px"
        >
          <Plus className="size-[18px]" />
          Log service
        </Link>
      </div>

      {odometerOpen ? (
        <UpdateOdometerSheet
          open
          onOpenChange={setOdometerOpen}
          accountId={account?.id}
          vehicleId={vehicleId}
          currentOdometerKm={currentOdometerKm}
        />
      ) : null}
    </div>
  )
}
