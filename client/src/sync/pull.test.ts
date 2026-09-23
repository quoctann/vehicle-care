import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '@/api/client'
import type { PullResponse } from '@/api/contract.types'
import { db } from '@/data/db'
import { clearAllTables } from '@/data/testUtils'
import { useSessionStore } from '@/stores/useSessionStore'
import { pullChanges } from './pull'

vi.mock('@/api/client', () => ({ pullChanges: vi.fn() }))

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

function vehicleChange(serverSeq: number, entityId: string) {
  return {
    server_seq: serverSeq,
    entity_type: 'vehicle' as const,
    entity_id: entityId,
    operation: 'create' as const,
    payload: {
      name: `Vehicle ${serverSeq}`,
      plate_number: null,
      archived_at: null,
      deleted_at: null,
    },
    received_at_server: `2026-09-17T10:00:0${serverSeq}.000Z`,
  }
}

async function seedSyncMeta() {
  await db.syncMeta.put({
    accountId,
    deviceId: 'device-1',
    lastSeenSeq: 0,
    nextLocalSeq: 1,
    lastSyncedAt: null,
    lastSyncError: null,
    bootstrapState: 'bootstrapping',
  })
}

afterEach(async () => {
  vi.clearAllMocks()
  useSessionStore.getState().clear()
  await clearAllTables()
})

describe('pullChanges', () => {
  it('reuses one upper bound and commits each page with its cursor', async () => {
    await seedSyncMeta()
    vi.mocked(api.pullChanges)
      .mockResolvedValueOnce({
        changes: [vehicleChange(1, 'vehicle-1')],
        next_cursor: 1,
      until_seq: 2,
        has_more: true,
        server_time: '2026-09-17T10:00:10.000Z',
      })
      .mockResolvedValueOnce({
        changes: [vehicleChange(2, 'vehicle-2')],
        next_cursor: 2,
        until_seq: 2,
        has_more: false,
        server_time: '2026-09-17T10:00:11.000Z',
      })

    await pullChanges(accountId)

    expect(api.pullChanges).toHaveBeenNthCalledWith(1, {
      afterSeq: 0,
      limit: 100,
    })
    expect(api.pullChanges).toHaveBeenNthCalledWith(2, {
      afterSeq: 1,
      limit: 100,
      untilSeq: 2,
    })
    expect(await db.syncMeta.get(accountId)).toMatchObject({ lastSeenSeq: 2 })
    expect(await db.vehicles.get('vehicle-2')).toMatchObject({
      accountId,
      serverSeq: 2,
    })
  })

  it('rolls back every entity and the cursor when one change cannot be applied', async () => {
    await seedSyncMeta()
    await db.vehicles.put({
      id: 'collision',
      accountId: 'another-account',
      name: 'Other account vehicle',
      plateNumber: null,
      archivedAt: null,
      deletedAt: null,
      dueSoonRatio: null,
      createdAtClient: '2026-09-17T09:00:00.000Z',
      receivedAtServer: null,
      serverSeq: null,
    })
    const page: PullResponse = {
      changes: [vehicleChange(1, 'would-be-inserted'), vehicleChange(2, 'collision')],
      next_cursor: 2,
        until_seq: 2,
      has_more: false,
      server_time: '2026-09-17T10:00:10.000Z',
    }
    vi.mocked(api.pullChanges).mockResolvedValueOnce(page)

    await expect(pullChanges(accountId)).rejects.toThrow('belongs to another account')

    expect(await db.vehicles.get('would-be-inserted')).toBeUndefined()
    expect(await db.syncMeta.get(accountId)).toMatchObject({ lastSeenSeq: 0 })
  })

  it('refuses a page when the account outbox is dirty', async () => {
    await seedSyncMeta()
    await db.outbox.put({
      mutationId: 'mutation-pending',
      accountId,
      localSeq: 1,
      entityType: 'vehicle',
      operation: 'create',
      entityId: 'vehicle-1',
      payload: { name: 'Local' },
      baseServerSeq: null,
      status: 'pending',
      retryCount: 0,
      lastError: null,
      failureKind: null,
      createdAt: '2026-09-17T10:00:00.000Z',
    })
    vi.mocked(api.pullChanges).mockResolvedValueOnce({
      changes: [],
      next_cursor: 1,
      until_seq: 1,
      has_more: false,
      server_time: '2026-09-17T10:00:10.000Z',
    })

    await expect(pullChanges(accountId)).rejects.toThrow('local mutations')
    expect(await db.syncMeta.get(accountId)).toMatchObject({ lastSeenSeq: 0 })
  })

  it('rejects an empty page that claims more changes without advancing the cursor', async () => {
    await seedSyncMeta()
    vi.mocked(api.pullChanges).mockResolvedValueOnce({
      changes: [],
      next_cursor: 0,
      until_seq: 1,
      has_more: true,
      server_time: '2026-09-17T10:00:10.000Z',
    })

    await expect(pullChanges(accountId)).rejects.toThrow('empty page')
    expect(await db.syncMeta.get(accountId)).toMatchObject({ lastSeenSeq: 0 })
  })
})
