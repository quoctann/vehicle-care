import { useLiveQuery } from 'dexie-react-hooks'
import { getCurrentOdometer, listReminderStatusesForVehicle } from '@/data/queries/reminderQueries'
import type { IanaTimezone } from '@/domain/types'

export function useReminderStatuses(
  accountId: string | undefined,
  vehicleId: string | undefined,
  accountTimezone: IanaTimezone,
  opts: { includeDisabled?: boolean } = {},
) {
  return useLiveQuery(
    () =>
      accountId && vehicleId
        ? listReminderStatusesForVehicle(accountId, vehicleId, accountTimezone, new Date().toISOString(), opts.includeDisabled)
        : Promise.resolve([]),
    [accountId, vehicleId, accountTimezone, opts.includeDisabled],
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
