import { useLiveQuery } from 'dexie-react-hooks'
import { getVehicle, listVehicles } from '@/data/queries/vehicleQueries'

/** Dexie là nguồn sự thật duy nhất — hook chỉ subscribe, KHÔNG copy data sang Zustand. */
export function useVehicles(accountId: string | undefined, opts: { includeArchived?: boolean } = {}) {
  return useLiveQuery(
    () => (accountId ? listVehicles(accountId, opts) : Promise.resolve([])),
    [accountId, opts.includeArchived],
  )
}

export function useVehicle(accountId: string | undefined, vehicleId: string | undefined) {
  const queryKey = accountId && vehicleId ? `${accountId}:${vehicleId}` : null
  return useLiveQuery(
    async () => ({
      queryKey,
      vehicle: accountId && vehicleId ? await getVehicle(accountId, vehicleId) : undefined,
    }),
    [accountId, vehicleId],
    { queryKey: null, vehicle: undefined },
  )
}
