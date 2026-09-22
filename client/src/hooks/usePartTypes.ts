import { useLiveQuery } from 'dexie-react-hooks'
import { listPartTypes } from '@/data/queries/partTypeQueries'

export function usePartTypes(accountId?: string) {
  return useLiveQuery(() => (accountId ? listPartTypes(accountId) : Promise.resolve([])), [accountId], [])
}
