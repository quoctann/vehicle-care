import { useLiveQuery } from 'dexie-react-hooks'
import { listHistoryEntries } from '@/data/queries/historyQueries'

export function useHistoryEntries(accountId: string | undefined, vehicleId: string | undefined) {
  return useLiveQuery(
    () => (accountId && vehicleId ? listHistoryEntries(accountId, vehicleId) : Promise.resolve([])),
    [accountId, vehicleId],
    [],
  )
}
