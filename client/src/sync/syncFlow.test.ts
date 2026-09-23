import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as api from '@/api/client'
import { db } from '@/data/db'
import { clearAllTables } from '@/data/testUtils'
import { repairBlockedMutation } from '@/data/outbox'
import { addOdometerLog } from '@/data/repositories/odometerRepository'
import { updateVehicle } from '@/data/repositories/vehicleRepository'
import { useSessionStore } from '@/stores/useSessionStore'
import { useSyncStore } from '@/stores/useSyncStore'
import { applyPulledChange } from './applyChange'
import { runSync } from './syncOrchestrator'
import { restoreFromServer } from './restore'

// Only the HTTP boundary is mocked: repositories, FIFO, ACK and pull all run.
vi.mock('@/api/client', () => ({ registerDevice: vi.fn(), pushMutations: vi.fn(), pullChanges: vi.fn() }))

const accountId = 'account-1'
const vehicleId = 'vehicle-1'
const timestamp = '2026-09-23T10:00:00.000Z'

beforeEach(async () => {
  useSessionStore.getState().setAuthenticated({ id: accountId, email: 'a@example.com', name: null, timezone: 'UTC', emailVerified: true })
  await db.syncMeta.put({ accountId, deviceId: 'stable-device', lastSeenSeq: 10, nextLocalSeq: 1, operation: 'idle', lastSyncedAt: null, lastSyncError: null, lastSyncFailureKind: null, bootstrapState: 'ready' })
  await db.vehicles.put({ id: vehicleId, accountId, name: 'Original', plateNumber: null, archivedAt: null, deletedAt: null, dueSoonRatio: null, createdAtClient: timestamp, receivedAtServer: timestamp, serverSeq: 10 })
  vi.mocked(api.registerDevice).mockResolvedValue({ device_id: 'stable-device', registered_at: timestamp })
})

afterEach(async () => {
  vi.resetAllMocks()
  vi.unstubAllGlobals()
  useSessionStore.getState().clear()
  useSyncStore.setState({ status: 'idle', lastSyncedAt: null, lastError: null })
  await clearAllTables()
})

it('applies canonical odometer fields after the ACK set the same server version', async () => {
  const log = await addOdometerLog({ accountId, vehicleId, odometerKm: 123.456, recordedAt: timestamp })
  vi.mocked(api.pushMutations).mockImplementation(async ({ mutations }) => ({ results: [{ mutation_id: mutations[0].mutation_id, status: 'applied', server_seq: 11, received_at_server: timestamp }] }))
  const change = {
    entity_type: 'odometer_log' as const, operation: 'create' as const, entity_id: log.id,
    payload: { vehicle_id: vehicleId, odometer_km: 123.46, recorded_at: timestamp, source: 'manual', note: null },
    server_seq: 11, received_at_server: timestamp,
  }
  vi.mocked(api.pullChanges).mockResolvedValue({ changes: [change], next_cursor: 11, until_seq: 11, has_more: false, server_time: timestamp })

  await runSync()

  expect(await db.odometerLogs.get(log.id)).toMatchObject({ odometerKm: 123.46, serverSeq: 11 })
  expect(await db.outbox.count()).toBe(0)
  expect(useSyncStore.getState().status).toBe('synced')
  await applyPulledChange({ ...change, server_seq: 10, payload: { ...change.payload, odometer_km: 99 } }, accountId)
  expect((await db.odometerLogs.get(log.id))?.odometerKm).toBe(123.46)
})

it('defers a racing pull without disabling auto-sync, then completes the next sync', async () => {
  vi.mocked(api.pullChanges).mockImplementationOnce(async () => {
    await updateVehicle(accountId, vehicleId, { name: 'New local edit' })
    return { changes: [{ entity_type: 'vehicle', operation: 'update', entity_id: vehicleId, payload: { name: 'Remote edit' }, server_seq: 11, received_at_server: timestamp }], next_cursor: 11, until_seq: 11, has_more: false, server_time: timestamp }
  })

  await runSync()

  expect((await db.vehicles.get(vehicleId))?.name).toBe('New local edit')
  expect(await db.syncMeta.get(accountId)).toMatchObject({ lastSeenSeq: 10, lastSyncError: null, lastSyncFailureKind: null, lastSyncedAt: null })
  expect(useSyncStore.getState().status).toBe('pending')
  vi.mocked(api.pushMutations).mockImplementation(async ({ mutations }) => ({ results: [{ mutation_id: mutations[0].mutation_id, status: 'applied', server_seq: 12, received_at_server: timestamp }] }))
  vi.mocked(api.pullChanges).mockResolvedValue({ changes: [{ entity_type: 'vehicle', operation: 'update', entity_id: vehicleId, payload: { name: 'New local edit' }, server_seq: 12, received_at_server: timestamp }], next_cursor: 12, until_seq: 12, has_more: false, server_time: timestamp })

  await runSync()

  expect(useSyncStore.getState().status).toBe('synced')
  expect(await db.syncMeta.get(accountId)).toMatchObject({ lastSeenSeq: 12 })
  expect(await db.outbox.count()).toBe(0)
})

it('leaves new work after the push high watermark pending without recording a failure', async () => {
  await updateVehicle(accountId, vehicleId, { name: 'First edit' })
  vi.mocked(api.pushMutations).mockImplementationOnce(async ({ mutations }) => {
    await updateVehicle(accountId, vehicleId, { name: 'Later edit' })
    return { results: [{ mutation_id: mutations[0].mutation_id, status: 'applied', server_seq: 11, received_at_server: timestamp }] }
  })

  await runSync()

  expect(api.pullChanges).not.toHaveBeenCalled()
  expect(await db.outbox.count()).toBe(1)
  expect((await db.vehicles.get(vehicleId))?.name).toBe('Later edit')
  expect(await db.syncMeta.get(accountId)).toMatchObject({ lastSyncError: null, lastSyncFailureKind: null })
  expect(useSyncStore.getState().status).toBe('pending')
})

it('repairs a rejected mutation and completes push then pull without leaving a blocked row', async () => {
  await updateVehicle(accountId, vehicleId, { name: 'Rejected edit' })
  const original = (await db.outbox.toArray())[0]
  vi.mocked(api.pushMutations).mockResolvedValueOnce({ results: [{ mutation_id: original.mutationId, status: 'rejected', error_message: 'Invalid vehicle' }] })
  await expect(runSync()).rejects.toThrow('Invalid vehicle')
  expect(api.pullChanges).not.toHaveBeenCalled()

  const fixed = await repairBlockedMutation(original.mutationId, { name: 'Fixed' })
  vi.mocked(api.pushMutations).mockResolvedValueOnce({ results: [{ mutation_id: fixed.mutationId, status: 'applied', server_seq: 11, received_at_server: timestamp }] })
  vi.mocked(api.pullChanges).mockResolvedValueOnce({ changes: [{ entity_type: 'vehicle', operation: 'update', entity_id: vehicleId, payload: { name: 'Fixed' }, server_seq: 11, received_at_server: timestamp }], next_cursor: 11, until_seq: 11, has_more: false, server_time: timestamp })
  await runSync()

  expect(fixed.mutationId).not.toBe(original.mutationId)
  expect(fixed.localSeq).toBe(original.localSeq)
  expect(await db.outbox.count()).toBe(0)
  expect((await db.vehicles.get(vehicleId))?.name).toBe('Fixed')
  expect(useSyncStore.getState().status).toBe('synced')
})

it('restores a blocked workspace from cursor zero through the real pull pipeline', async () => {
  await updateVehicle(accountId, vehicleId, { name: 'Discard me' })
  const item = (await db.outbox.toArray())[0]
  vi.mocked(api.pushMutations).mockResolvedValueOnce({ results: [{ mutation_id: item.mutationId, status: 'rejected', error_message: 'Bad data' }] })
  await expect(runSync()).rejects.toThrow('Bad data')
  vi.mocked(api.pullChanges).mockResolvedValueOnce({
    changes: [
      { entity_type: 'part_type', operation: 'create', entity_id: 'seed-part', payload: { code: 'engine_oil', name_vi: 'Dầu nhớt', display_order: 1, active: true, seed_version: '1' }, server_seq: 1, received_at_server: timestamp },
      { entity_type: 'vehicle', operation: 'create', entity_id: vehicleId, payload: { name: 'Server truth' }, server_seq: 2, received_at_server: timestamp },
    ], next_cursor: 2, until_seq: 2, has_more: false, server_time: timestamp,
  })

  await restoreFromServer(accountId)

  expect(api.pullChanges).toHaveBeenCalledWith({ afterSeq: 0, limit: 100 })
  expect(await db.outbox.count()).toBe(0)
  expect((await db.vehicles.get(vehicleId))?.name).toBe('Server truth')
  expect(await db.partTypes.get('seed-part')).toBeDefined()
  expect(await db.syncMeta.get(accountId)).toMatchObject({ operation: 'idle', lastSeenSeq: 2, bootstrapState: 'ready' })
  expect(useSyncStore.getState().status).toBe('synced')
})

it('retries the same device and envelope after a lost response and changed localStorage', async () => {
  await updateVehicle(accountId, vehicleId, { name: 'Committed before timeout' })
  const item = (await db.outbox.toArray())[0]
  vi.mocked(api.pushMutations)
    .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    .mockResolvedValueOnce({ results: [{ mutation_id: item.mutationId, status: 'duplicate', server_seq: 11, received_at_server: timestamp }] })
  await expect(runSync()).rejects.toThrow('Failed to fetch')
  vi.stubGlobal('localStorage', { getItem: () => 'replacement-device', setItem: vi.fn() })
  vi.mocked(api.pullChanges).mockResolvedValueOnce({ changes: [{ entity_type: 'vehicle', operation: 'update', entity_id: vehicleId, payload: { name: 'Committed before timeout' }, server_seq: 11, received_at_server: timestamp }], next_cursor: 11, until_seq: 11, has_more: false, server_time: timestamp })

  await runSync()

  const requests = vi.mocked(api.pushMutations).mock.calls.map(([request]) => request)
  expect(requests[1]).toEqual(requests[0])
  expect(requests[1].device_id).toBe('stable-device')
  expect(await db.outbox.count()).toBe(0)
  expect(useSyncStore.getState().status).toBe('synced')
})
