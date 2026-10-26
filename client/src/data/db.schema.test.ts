import Dexie from 'dexie';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { db, type OutboxItem, type SyncMeta } from './db';
import type { PartType } from '@/domain/types';

beforeEach(async () => {
  db.close();
  await Dexie.delete(db.name);
  await db.open();
});

afterEach(async () => {
  db.close();
  await Dexie.delete(db.name);
});

it('creates the complete v1 baseline with current indexes', async () => {
  await db.open();
  expect(db.verno).toBe(1);
  expect(
    Object.fromEntries(
      db.tables.map(({ name, schema }) => [
        name,
        [schema.primKey.src, ...schema.indexes.map((index) => index.src)],
      ]),
    ),
  ).toEqual({
    vehicles: ['id', 'accountId', 'archivedAt', 'deletedAt'],
    partTypes: ['id', '&[accountId+code]', 'active', 'accountId'],
    reminderConfigs: ['id', 'accountId', 'vehicleId', '[vehicleId+partTypeId]', 'deletedAt'],
    odometerLogs: ['id', 'accountId', 'vehicleId', '[vehicleId+recordedAt]'],
    fuelLogs: ['id', 'accountId', 'vehicleId', 'deletedAt'],
    serviceLogs: ['id', 'accountId', 'vehicleId', '[vehicleId+partTypeId+servicedAt]', 'deletedAt'],
    outbox: [
      'mutationId',
      'entityId',
      'accountId',
      'status',
      'localSeq',
      '[accountId+localSeq]',
      '[accountId+status+localSeq]',
    ],
    syncMeta: ['accountId'],
    accountCache: ['id'],
  });
});

it('enforces part-type code uniqueness within each account only', async () => {
  const partType: PartType = {
    id: 'part-a',
    accountId: 'a',
    code: 'oil',
    displayName: 'Oil',
    displayOrder: 0,
    active: true,
    serverSeq: null,
    serverSyncedAt: null,
    createdAtClient: '2026-01-01T00:00:00Z',
  };
  await db.partTypes.bulkAdd([partType, { ...partType, id: 'part-b', accountId: 'b' }]);
  await expect(db.partTypes.add({ ...partType, id: 'duplicate' })).rejects.toMatchObject({
    name: 'ConstraintError',
  });
  expect(await db.partTypes.count()).toBe(2);
});

const mutation = (
  mutationId: string,
  accountId: string,
  localSeq: number,
  status: OutboxItem['status'] = 'pending',
): OutboxItem => ({
  mutationId,
  accountId,
  localSeq,
  entityType: 'vehicle',
  entityId: 'vehicle',
  operation: 'update',
  payload: { name: 'Snapshot 🔧', extra: ['preserve'] },
  baseServerSeq: 7,
  status,
  retryCount: 2,
  lastError: 'Sync failed',
  failureKind: status === 'blocked' ? 'terminal' : 'retryable',
  createdAt: '2026-01-01T00:00:00Z',
});

it('supports account-scoped FIFO and global pending queries', async () => {
  await db.outbox.bulkAdd([
    mutation('a-3', 'a', 3),
    mutation('b-1', 'b', 1),
    mutation('a-2', 'a', 2, 'blocked'),
    mutation('a-1', 'a', 1),
  ]);
  const fifo = await db.outbox
    .where('[accountId+localSeq]')
    .between(['a', Dexie.minKey], ['a', Dexie.maxKey])
    .toArray();
  expect(fifo.map((row) => row.mutationId)).toEqual(['a-1', 'a-2', 'a-3']);
  const pending = await db.outbox
    .where('[accountId+status+localSeq]')
    .between(['a', 'pending', Dexie.minKey], ['a', 'pending', Dexie.maxKey])
    .toArray();
  expect(pending.map((row) => row.mutationId)).toEqual(['a-1', 'a-3']);
  expect(await db.outbox.where('status').equals('pending').count()).toBe(3);
});

it('preserves mutation snapshots and recovery metadata when reopened', async () => {
  const row = mutation('retry', 'a', 4, 'blocked');
  const meta: SyncMeta = {
    accountId: 'a',
    deviceId: 'stable-device',
    lastSeenSeq: 12,
    nextLocalSeq: 5,
    operation: 'restore_failed',
    lastSyncedAt: '2026-01-01T00:00:00Z',
    lastSyncError: 'Restore failed',
    lastSyncFailureKind: 'retryable',
    bootstrapState: 'ready',
  };
  await db.transaction('rw', [db.outbox, db.syncMeta], async () => {
    await db.outbox.add(row);
    await db.syncMeta.add(meta);
  });
  db.close();
  await db.open();
  expect(await db.outbox.get(row.mutationId)).toEqual(row);
  expect(await db.syncMeta.get(meta.accountId)).toEqual(meta);
});
