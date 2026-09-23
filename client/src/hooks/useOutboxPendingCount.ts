import { useLiveQuery } from 'dexie-react-hooks'
import { countUnresolvedOutboxForAccount, listOutboxForAccount } from '@/data/outbox'
import { useSessionStore } from '@/stores/useSessionStore'

export function useOutboxPendingCount(): number {
  const accountId = useSessionStore((state) => state.account?.id)
  return useLiveQuery(() => (accountId ? countUnresolvedOutboxForAccount(accountId) : Promise.resolve(0)), [accountId], 0) ?? 0
}

export function useOutboxState(accountId: string | undefined): { pending: number; blocked: number; retryable: number } {
  return useLiveQuery(
    async () => {
      if (!accountId) return { pending: 0, blocked: 0, retryable: 0 }
      const rows = await listOutboxForAccount(accountId)
      return {
        pending: rows.filter((row) => row.status === 'pending').length,
        blocked: rows.filter((row) => row.status === 'blocked').length,
        retryable: rows.filter((row) => row.status === 'pending' && row.failureKind === 'retryable').length,
      }
    },
    [accountId],
    { pending: 0, blocked: 0, retryable: 0 },
  ) ?? { pending: 0, blocked: 0, retryable: 0 }
}
