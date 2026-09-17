import { afterEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/data/db'
import { ApiError } from '@/api/errors'
import { clearAllTables } from '@/data/testUtils'
import { useSessionStore } from '@/stores/useSessionStore'
import { useSyncStore } from '@/stores/useSyncStore'
import { bootstrapSync } from './bootstrap'
import { pullChanges } from './pull'
import { pushOutbox } from './push'
import { runSync } from './syncOrchestrator'

vi.mock('./bootstrap', () => ({ bootstrapSync: vi.fn() }))
vi.mock('./pull', () => ({ pullChanges: vi.fn() }))
vi.mock('./push', () => ({ pushOutbox: vi.fn() }))

afterEach(async () => {
  vi.clearAllMocks()
  useSessionStore.setState({ status: 'anonymous', account: null })
  useSyncStore.setState({
    status: 'idle',
    lastSyncedAt: null,
    lastError: null,
  })
  await clearAllTables()
})

describe('runSync', () => {
  it('deduplicates concurrent runs and pushes before pulling', async () => {
    const calls: string[] = []
    useSessionStore.setState({
      status: 'authenticated',
      account: {
        id: 'account-1',
        email: 'rider@example.com',
        name: null,
        timezone: 'UTC',
        emailVerified: true,
      },
    })
    await db.syncMeta.put({
      accountId: 'account-1',
      deviceId: 'device-1',
      lastSeenSeq: 0,
      lastSyncedAt: null,
      lastSyncError: null,
      bootstrapState: 'bootstrapping',
    })

    let finishBootstrap!: () => void
    vi.mocked(bootstrapSync).mockImplementation(
      () =>
        new Promise((resolve) => {
          finishBootstrap = () => resolve({ accountId: 'account-1', deviceId: 'device-1' })
        }),
    )
    vi.mocked(pushOutbox).mockImplementation(async () => {
      calls.push('push')
    })
    vi.mocked(pullChanges).mockImplementation(async () => {
      calls.push('pull')
    })

    const first = runSync()
    const second = runSync()
    expect(second).toBe(first)
    finishBootstrap()
    await first

    expect(calls).toEqual(['push', 'pull'])
    expect(useSyncStore.getState().status).toBe('synced')
    expect(await db.syncMeta.get('account-1')).toMatchObject({
      bootstrapState: 'ready',
      lastSyncError: null,
    })
  })

  it('clears the local session when sync reports an expired session', async () => {
    useSessionStore.setState({
      status: 'authenticated',
      account: { id: 'account-1', email: 'rider@example.com', name: null, timezone: 'UTC', emailVerified: true },
    })
    vi.mocked(bootstrapSync).mockResolvedValue({ accountId: 'account-1', deviceId: 'device-1' })
    vi.mocked(pushOutbox).mockRejectedValue(
      new ApiError(
        { error: { code: 'session_expired', message: 'Expired', retryable: false, request_id: 'request-1' } },
        401,
      ),
    )

    await expect(runSync()).rejects.toThrow('Expired')
    expect(useSessionStore.getState()).toMatchObject({ status: 'anonymous', account: null })
  })
})
