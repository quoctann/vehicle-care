import { afterEach, describe, expect, it } from 'vitest'
import type { PartType } from '@/domain/types'
import { clearAllTables } from '@/data/testUtils'
import { db } from '../db'
import { listPartTypes } from './partTypeQueries'

const basePartType: Omit<PartType, 'id' | 'accountId' | 'displayOrder'> = {
  code: 'engine_oil',
  displayName: 'Dầu động cơ',
  active: true,
  seedVersion: 1,
  createdAtClient: '2026-09-22T00:00:00.000Z',
  receivedAtServer: '2026-09-22T00:00:00.000Z',
  serverSeq: 1,
}

afterEach(clearAllTables)

describe('listPartTypes', () => {
  it('returns only the requested account catalog in display order', async () => {
    await db.partTypes.bulkAdd([
      { ...basePartType, id: 'part-a-2', code: 'part-a-2', accountId: 'account-a', displayOrder: 2 },
      { ...basePartType, id: 'part-b-1', code: 'engine_oil', accountId: 'account-b', displayOrder: 1 },
      { ...basePartType, id: 'part-a-1', code: 'engine_oil', accountId: 'account-a', displayOrder: 1 },
    ])

    const result = await listPartTypes('account-a')

    expect(result.map((partType) => partType.id)).toEqual(['part-a-1', 'part-a-2'])
  })
})
