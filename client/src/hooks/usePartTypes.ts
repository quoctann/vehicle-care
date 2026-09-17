import { useLiveQuery } from 'dexie-react-hooks'
import { listPartTypes } from '@/data/queries/partTypeQueries'

export function usePartTypes() {
  return useLiveQuery(() => listPartTypes(), [], [])
}
