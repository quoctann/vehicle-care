import { useLiveQuery } from 'dexie-react-hooks'
import { countPendingOutboxForAccount } from '@/data/outbox'
import { useSessionStore } from '@/stores/useSessionStore'

export function useOutboxPendingCount(): number {
  const accountId = useSessionStore((state) => state.account?.id)
  return useLiveQuery(() => (accountId ? countPendingOutboxForAccount(accountId) : Promise.resolve(0)), [accountId], 0) ?? 0
}
