import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '@/api/client'
import { db, type OutboxItem } from '@/data/db'
import { repairBlockedMutation } from '@/data/outbox'
import { clearAllTables } from '@/data/testUtils'
import { useSessionStore } from '@/stores/useSessionStore'
import { pushOutbox } from './push'

vi.mock('@/api/client', () => ({ pushMutations: vi.fn() }))

const accountId = 'account-1'

beforeEach(() => {
  useSessionStore.getState().setAuthenticated({
    id: accountId,
    email: 'test@example.com',
    name: null,
    timezone: 'UTC',
    emailVerified: true,
  })
})

afterEach(async () => {
  vi.clearAllMocks()
  useSessionStore.getState().clear()
  await clearAllTables()
})

function vehicle(id: string, name: string, serverSeq: number | null = null) {
  return {
    id,
    accountId,
    name,
    plateNumber: null,
    archivedAt: null,
    deletedAt: null,
    dueSoonRatio: null,
    createdAtClient: '2026-09-17T09:00:00.000Z',
    receivedAtServer: serverSeq == null ? null : '2026-09-17T10:00:00.000Z',
    serverSeq,
  }
}

function outboxItem(overrides: Partial<OutboxItem>): OutboxItem {
  return {
    mutationId: 'mutation-1',
    accountId,
    localSeq: 1,
    entityType: 'vehicle',
    operation: 'update',
    entityId: 'vehicle-1',
    payload: { name: 'Local' },
    baseServerSeq: null,
    status: 'pending',
      retryCount: 0,
      lastError: null,
      failureKind: null,
    createdAt: '2026-09-17T10:00:00.000Z',
    ...overrides,
  }
}

describe('pushOutbox', () => {
  it('sends every mutation in local FIFO order without coalescing', async () => {
    await db.vehicles.put(vehicle('vehicle-1', 'Latest'))
    await db.outbox.bulkAdd([
      outboxItem({ mutationId: 'mutation-1', localSeq: 1, payload: { name: 'Old' } }),
      outboxItem({ mutationId: 'mutation-2', localSeq: 2, payload: { name: 'Latest' } }),
    ])
    vi.mocked(api.pushMutations).mockImplementation(async ({ mutations }) => ({
      results: [{
        mutation_id: mutations[0].mutation_id,
        status: 'applied',
        server_seq: mutations[0].mutation_id === 'mutation-1' ? 7 : 8,
        received_at_server: '2026-09-17T10:01:00.000Z',
      }],
    }))

    await pushOutbox('device-1', accountId)

    expect(vi.mocked(api.pushMutations).mock.calls.map(([request]) => request.mutations[0].mutation_id)).toEqual([
      'mutation-1',
      'mutation-2',
    ])
    expect(await db.outbox.toArray()).toEqual([])
    expect(await db.vehicles.get('vehicle-1')).toMatchObject({ serverSeq: 8 })
  })

  it('keeps a retryable mutation pending and stops before the next FIFO item', async () => {
    await db.vehicles.put(vehicle('vehicle-1', 'Local'))
    await db.outbox.bulkAdd([
      outboxItem({ mutationId: 'mutation-1', localSeq: 1 }),
      outboxItem({ mutationId: 'mutation-2', localSeq: 2 }),
    ])
    vi.mocked(api.pushMutations).mockResolvedValue({
      results: [{ mutation_id: 'mutation-1', status: 'retryable_error', error_message: 'Try later' }],
    })

    await expect(pushOutbox('device-1', accountId)).rejects.toThrow('Try later')

    expect(api.pushMutations).toHaveBeenCalledTimes(1)
    expect(await db.outbox.get('mutation-1')).toMatchObject({ status: 'pending', retryCount: 1, lastError: 'Try later' })
    expect(await db.outbox.get('mutation-2')).toMatchObject({ status: 'pending' })
  })

  it('blocks terminal mutations and repairs them with a new mutation id', async () => {
    await db.vehicles.put(vehicle('vehicle-1', 'Local'))
    await db.outbox.add(outboxItem({ mutationId: 'mutation-blocked' }))
    vi.mocked(api.pushMutations).mockResolvedValue({
      results: [{ mutation_id: 'mutation-blocked', status: 'rejected', error_message: 'Invalid vehicle' }],
    })

    await expect(pushOutbox('device-1', accountId)).rejects.toThrow('Invalid vehicle')

    expect(await db.outbox.get('mutation-blocked')).toMatchObject({ status: 'blocked', lastError: 'Invalid vehicle' })
    const replacement = await repairBlockedMutation('mutation-blocked', { name: 'Repaired' })
    expect(replacement).toMatchObject({ accountId, localSeq: 1, status: 'pending', payload: { name: 'Repaired' } })
    expect(replacement.mutationId).not.toBe('mutation-blocked')
    expect(await db.outbox.get('mutation-blocked')).toBeUndefined()
  })

  it('does not let repair of an older blocked revision overwrite a newer local snapshot', async () => {
    await db.vehicles.put(vehicle('vehicle-1', 'Newest local'))
    await db.outbox.bulkAdd([
      outboxItem({ mutationId: 'mutation-blocked', localSeq: 1, status: 'blocked', failureKind: 'terminal', payload: { name: 'Old invalid' } }),
      outboxItem({ mutationId: 'mutation-newer', localSeq: 2, payload: { name: 'Newest local' } }),
    ])

    await repairBlockedMutation('mutation-blocked', { name: 'Repaired old revision' })

    expect(await db.vehicles.get('vehicle-1')).toMatchObject({ name: 'Newest local' })
    expect((await db.outbox.where('[accountId+localSeq]').equals([accountId, 1]).first())?.payload).toEqual({ name: 'Repaired old revision' })
  })

  it('acknowledges an older mutation without overwriting metadata for a newer local revision', async () => {
    await db.vehicles.put(vehicle('vehicle-1', 'Newest local', 10))
    await db.outbox.bulkAdd([
      outboxItem({ mutationId: 'mutation-old', localSeq: 1, payload: { name: 'Old' } }),
      outboxItem({ mutationId: 'mutation-new', localSeq: 2, payload: { name: 'Newest local' } }),
    ])
    vi.mocked(api.pushMutations)
      .mockResolvedValueOnce({
        results: [{ mutation_id: 'mutation-old', status: 'duplicate', server_seq: 7, received_at_server: '2026-09-17T10:01:00.000Z' }],
      })
      .mockResolvedValueOnce({
        results: [{ mutation_id: 'mutation-new', status: 'applied', server_seq: 11, received_at_server: '2026-09-17T10:02:00.000Z' }],
      })

    await pushOutbox('device-1', accountId)

    expect(await db.outbox.toArray()).toEqual([])
    expect(await db.vehicles.get('vehicle-1')).toMatchObject({ name: 'Newest local', serverSeq: 11 })
  })

  it('stops at the queue high watermark when new local work arrives during push', async () => {
    await db.vehicles.put(vehicle('vehicle-1', 'Local'))
    await db.outbox.add(outboxItem({ mutationId: 'mutation-1', localSeq: 1 }))
    vi.mocked(api.pushMutations).mockImplementationOnce(async () => {
      await db.outbox.add(outboxItem({ mutationId: 'mutation-later', localSeq: 2 }))
      return { results: [{ mutation_id: 'mutation-1', status: 'applied', server_seq: 7, received_at_server: '2026-09-17T10:01:00.000Z' }] }
    })

    await pushOutbox('device-1', accountId)

    expect(api.pushMutations).toHaveBeenCalledTimes(1)
    expect(await db.outbox.get('mutation-later')).toMatchObject({ status: 'pending' })
  })
})
