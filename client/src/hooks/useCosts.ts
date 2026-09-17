import { useLiveQuery } from 'dexie-react-hooks'
import { getCostPerKm, getMonthlyCosts } from '@/data/queries/costQueries'
import type { IanaTimezone } from '@/domain/types'

export function useMonthlyCosts(accountId: string | undefined, vehicleId: string | undefined, accountTimezone: IanaTimezone) {
  return useLiveQuery(
    () => (accountId && vehicleId ? getMonthlyCosts(accountId, vehicleId, accountTimezone) : Promise.resolve([])),
    [accountId, vehicleId, accountTimezone],
    [],
  )
}

export function useCostPerKm(accountId: string | undefined, vehicleId: string | undefined, monthsBack = 3) {
  return useLiveQuery(
    () => (accountId && vehicleId ? getCostPerKm(accountId, vehicleId, monthsBack) : Promise.resolve(null)),
    [accountId, vehicleId, monthsBack],
    null,
  )
}
