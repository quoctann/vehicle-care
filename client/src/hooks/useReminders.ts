import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getCurrentOdometer, listReminderStatusesForVehicle } from '@/data/queries/reminderQueries'
import type { IanaTimezone } from '@/domain/types'

export function useReminderStatuses(
  accountId: string | undefined,
  vehicleId: string | undefined,
  accountTimezone: IanaTimezone,
  opts: { includeDisabled?: boolean } = {},
) {
  const [now, setNow] = useState(() => new Date().toISOString())
  useEffect(() => {
    const refresh = () => setNow(new Date().toISOString())
    const timer = window.setInterval(refresh, 60_000)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])
  return useLiveQuery(
    () =>
      accountId && vehicleId
        ? listReminderStatusesForVehicle(accountId, vehicleId, accountTimezone, now, opts.includeDisabled)
        : Promise.resolve([]),
    [accountId, vehicleId, accountTimezone, opts.includeDisabled, now],
    [],
  )
}

export function useCurrentOdometer(accountId: string | undefined, vehicleId: string | undefined) {
  return useLiveQuery(
    () => (accountId && vehicleId ? getCurrentOdometer(accountId, vehicleId) : Promise.resolve(null)),
    [accountId, vehicleId],
    null,
  )
}
