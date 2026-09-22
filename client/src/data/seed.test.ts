import { afterEach, describe, expect, it, vi } from 'vitest'
import * as api from '@/api/client'
import { clearAllTables } from './testUtils'
import { db } from './db'
import { refreshPartTypesFromServer } from './seed'

vi.mock('@/api/client', () => ({ listPartTypes: vi.fn() }))

afterEach(async () => {
  vi.clearAllMocks()
  await clearAllTables()
})

describe('refreshPartTypesFromServer', () => {
  it('preserves a pending local edit while refreshing server metadata', async () => {
    await putLocalPartType('pending')
    mockServerPartType()

    await refreshPartTypesFromServer()

    expect(await db.partTypes.get('part-1')).toMatchObject({
      displayName: 'Tên đang chờ đồng bộ',
      active: false,
      serverSeq: 8,
      receivedAtServer: '2026-09-22T10:00:00.000Z',
    })
  })

  it('requeues a legacy rejected edit with fresh server metadata', async () => {
    await putLocalPartType('rejected')
    mockServerPartType()

    await refreshPartTypesFromServer()

    expect(await db.outbox.get('mutation-old')).toMatchObject({ status: 'applied' })
    const pending = await db.outbox.where('status').equals('pending').toArray()
    expect(pending).toHaveLength(1)
    expect(pending[0]).toMatchObject({
      entityType: 'part_type',
      operation: 'update',
      entityId: 'part-1',
      payload: expect.objectContaining({ name_vi: 'Tên đang chờ đồng bộ', active: false }),
    })
  })
})

async function putLocalPartType(status: 'pending' | 'rejected') {
  await db.partTypes.put({
    id: 'part-1',
    code: 'engine_oil',
    displayName: 'Tên đang chờ đồng bộ',
    displayOrder: 1,
    active: false,
    seedVersion: 1,
    accountId: 'account-1',
    createdAtClient: '2026-09-22T09:00:00.000Z',
    receivedAtServer: null,
    serverSeq: null,
  })
  await db.outbox.put({
    mutationId: 'mutation-old',
    entityType: 'part_type',
    operation: 'create',
    entityId: 'part-1',
    payload: { code: 'engine_oil', name_vi: 'Tên đang chờ đồng bộ', display_order: 1, active: false, seed_version: '1' },
    status,
    retryCount: 0,
    lastError: status === 'rejected' ? 'part_type code must equal its id' : null,
    createdAt: '2026-09-22T09:00:00.000Z',
  })
}

function mockServerPartType() {
  vi.mocked(api.listPartTypes).mockResolvedValue({
    part_types: [{
      id: 'part-1',
      code: 'engine_oil',
      name_vi: 'Dầu động cơ',
      display_order: 1,
      active: true,
      seed_version: '1',
      account_id: 'account-1',
      server_seq: 8,
      received_at_server: '2026-09-22T10:00:00.000Z',
    }],
  })
}
