import { useSessionStore } from '@/stores/useSessionStore'

export function assertActiveSyncAccount(accountId: string): void {
  const session = useSessionStore.getState()
  if (session.status !== 'authenticated' || session.account?.id !== accountId) {
    throw new Error('The active account changed during sync.')
  }
}
