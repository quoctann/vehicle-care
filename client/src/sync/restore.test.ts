import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db } from '@/data/db'
import { createVehicle } from '@/data/repositories/vehicleRepository'
import { clearAllTables } from '@/data/testUtils'
import { useSessionStore } from '@/stores/useSessionStore'
import { pullChanges } from './pull'
import { restoreFromServer, resumeRestoreFromServer } from './restore'

vi.mock('./pull', () => ({ pullChanges: vi.fn() }))

const accountId = 'account-1'

beforeEach(async () => {
  useSessionStore.getState().setAuthenticated({ id: accountId, email: 'a@example.com', name: null, timezone: 'UTC', emailVerified: true })
  await db.syncMeta.put({
    accountId,
    deviceId: 'device-1',
    lastSeenSeq: 5,
    nextLocalSeq: 1,
    operation: 'idle',
    lastSyncedAt: null,
    lastSyncError: null,
    lastSyncFailureKind: null,
    bootstrapState: 'ready',
  })
})

afterEach(async () => {
  vi.clearAllMocks()
  useSessionStore.getState().clear()
  await clearAllTables()
})

it('persists restore failure and resumes without clearing committed pages again', async () => {
  vi.mocked(pullChanges)
    .mockImplementationOnce(async () => {
      await db.vehicles.put({
        id: 'server-vehicle', accountId, name: 'Restored page', plateNumber: null, archivedAt: null,
        deletedAt: null, dueSoonRatio: null, createdAtClient: new Date().toISOString(), receivedAtServer: new Date().toISOString(), serverSeq: 1,
      })
      await db.syncMeta.update(accountId, { lastSeenSeq: 1 })
      throw new Error('network interrupted')
    })
    .mockResolvedValueOnce('complete')

  await expect(restoreFromServer(accountId)).rejects.toThrow('network interrupted')
  expect(await db.syncMeta.get(accountId)).toMatchObject({ operation: 'restore_failed', lastSeenSeq: 1 })

  await restoreFromServer(accountId)

  expect(await db.vehicles.get('server-vehicle')).toBeDefined()
  expect(await db.syncMeta.get(accountId)).toMatchObject({ operation: 'idle', bootstrapState: 'ready' })
})

it('rolls back local writes while workspace recovery is active', async () => {
  await db.syncMeta.update(accountId, { operation: 'restoring' })

  await expect(createVehicle({ accountId, name: 'Must not be saved', plateNumber: null })).rejects.toThrow('Workspace recovery')

  expect(await db.vehicles.count()).toBe(0)
  expect(await db.outbox.count()).toBe(0)
})

it('resumes an interrupted restore without clearing pages already committed', async () => {
  await db.syncMeta.update(accountId, { operation: 'restoring', lastSeenSeq: 1 })
  await db.vehicles.put({
    id: 'committed-page', accountId, name: 'Already restored', plateNumber: null, archivedAt: null,
    deletedAt: null, dueSoonRatio: null, createdAtClient: new Date().toISOString(), receivedAtServer: new Date().toISOString(), serverSeq: 1,
  })
  vi.mocked(pullChanges).mockImplementationOnce(async () => {
    expect(await db.vehicles.get('committed-page')).toBeDefined()
    return 'complete'
  })

  await resumeRestoreFromServer(accountId)

  expect(await db.vehicles.get('committed-page')).toBeDefined()
  expect(await db.syncMeta.get(accountId)).toMatchObject({ operation: 'idle', bootstrapState: 'ready' })
})

it('does not restart a restore that another tab already completed', async () => {
  await resumeRestoreFromServer(accountId)

  expect(pullChanges).not.toHaveBeenCalled()
  expect(await db.syncMeta.get(accountId)).toMatchObject({ operation: 'idle' })
})
