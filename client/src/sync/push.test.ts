import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '@/api/client'
import { db, type OutboxItem } from '@/data/db'
import { clearAllTables } from '@/data/testUtils'
import { useSessionStore } from '@/stores/useSessionStore'
import { pushOutbox } from './push'

vi.mock('@/api/client', () => ({ pushMutations: vi.fn() }))

beforeEach(() => {
  useSessionStore.getState().setAuthenticated({
    id: 'account-1',
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

describe('pushOutbox', () => {
  it('coalesces mutable rows to the latest snapshot and applies a conflict result', async () => {
    await db.vehicles.put({
      id: 'vehicle-1',
      accountId: 'account-1',
      name: 'Latest',
      plateNumber: null,
      archivedAt: null,
      deletedAt: null,
      dueSoonRatio: null,
      createdAtClient: '2026-09-17T09:00:00.000Z',
      receivedAtServer: null,
      serverSeq: null,
    })
    const common: Omit<OutboxItem, 'mutationId' | 'payload'> = {
      entityType: 'vehicle',
      operation: 'update',
      entityId: 'vehicle-1',
      status: 'pending',
      retryCount: 0,
      lastError: null,
      createdAt: '2026-09-17T10:00:00.000Z',
    }
    await db.outbox.bulkAdd([
      {
        ...common,
        mutationId: 'mutation-old',
        payload: { name: 'Old' },
        createdAt: '2026-09-17T09:59:59.999Z',
      },
      {
        ...common,
        mutationId: 'mutation-latest',
        payload: { name: 'Latest', plate_number: null },
      },
    ])
    vi.mocked(api.pushMutations).mockImplementation(async ({ mutations }) => ({
      results: mutations.map((mutation) => ({
        mutation_id: mutation.mutation_id,
        status: 'conflict_resolved' as const,
        server_seq: 7,
        received_at_server: '2026-09-17T10:01:00.000Z',
        server_snapshot: mutation.payload,
      })),
    }))

    await pushOutbox('device-1', 'account-1')

    expect(api.pushMutations).toHaveBeenCalledWith(
      expect.objectContaining({
        mutations: [
          expect.objectContaining({
            mutation_id: 'mutation-latest',
            operation: 'create',
            payload: { name: 'Latest', plate_number: null },
          }),
        ],
      }),
    )
    expect(await db.outbox.get('mutation-old')).toMatchObject({
      status: 'applied',
    })
    expect(await db.outbox.get('mutation-latest')).toMatchObject({
      status: 'applied',
    })
    expect(await db.vehicles.get('vehicle-1')).toMatchObject({
      name: 'Latest',
      serverSeq: 7,
    })
  })

  it('rejects a stale acknowledgment without advancing entity metadata', async () => {
    await db.vehicles.put({
      id: 'vehicle-stale',
      accountId: 'account-1',
      name: 'Current',
      plateNumber: null,
      archivedAt: null,
      deletedAt: null,
      dueSoonRatio: null,
      createdAtClient: '2026-09-17T09:00:00.000Z',
      receivedAtServer: '2026-09-17T10:00:00.000Z',
      serverSeq: 10,
    })
    await db.outbox.add({
      mutationId: 'mutation-stale',
      entityType: 'vehicle',
      operation: 'update',
      entityId: 'vehicle-stale',
      payload: { name: 'Current', plate_number: null, archived_at: null, deleted_at: null },
      status: 'pending',
      retryCount: 0,
      lastError: null,
      createdAt: '2026-09-17T10:01:00.000Z',
    })
    vi.mocked(api.pushMutations).mockResolvedValue({
      results: [{
        mutation_id: 'mutation-stale',
        status: 'applied',
        server_seq: 7,
        received_at_server: '2026-09-17T10:02:00.000Z',
      }],
    })

    await expect(pushOutbox('device-1', 'account-1')).rejects.toThrow('stale acknowledgment')
    expect(await db.vehicles.get('vehicle-stale')).toMatchObject({ serverSeq: 10 })
    expect(await db.outbox.get('mutation-stale')).toMatchObject({ status: 'pending' })
  })

  it('keeps a server-rejected mutation visible for user action', async () => {
    await db.vehicles.put({
      id: 'vehicle-rejected',
      accountId: 'account-1',
      name: 'Rejected',
      plateNumber: null,
      archivedAt: null,
      deletedAt: null,
      dueSoonRatio: null,
      createdAtClient: '2026-09-17T09:00:00.000Z',
      receivedAtServer: null,
      serverSeq: null,
    })
    await db.outbox.add({
      mutationId: 'mutation-rejected',
      entityType: 'vehicle',
      operation: 'create',
      entityId: 'vehicle-rejected',
      payload: { name: 'Rejected' },
      status: 'pending',
      retryCount: 0,
      lastError: null,
      createdAt: '2026-09-17T10:01:00.000Z',
    })
    vi.mocked(api.pushMutations).mockResolvedValue({
      results: [{
        mutation_id: 'mutation-rejected',
        status: 'rejected',
        error_code: 'validation_failed',
        error_message: 'Invalid vehicle',
        retryable: false,
      }],
    })

    await pushOutbox('device-1', 'account-1')

    expect(await db.outbox.get('mutation-rejected')).toMatchObject({
      status: 'rejected',
      lastError: 'Invalid vehicle',
    })
  })
})
