import Dexie from 'dexie';
import { afterEach, expect, it } from 'vitest';
import { db } from './db';

afterEach(async () => {
  db.close();
  await Dexie.delete(db.name);
});

it('upgrades v4 historical vocabulary to v9 without rewriting snapshots or FIFO revisions', async () => {
  db.close();
  await Dexie.delete(db.name);
  const legacy = new Dexie(db.name);
  legacy.version(4).stores({
    vehicles: 'id, accountId, archivedAt, deletedAt',
    partTypes: 'id, &[accountId+code], active, accountId',
    reminderConfigs: 'id, accountId, vehicleId, [vehicleId+partTypeId], deletedAt',
    odometerLogs: 'id, accountId, vehicleId, [vehicleId+recordedAt]',
    fuelLogs: 'id, accountId, vehicleId, deletedAt',
    serviceLogs: 'id, accountId, vehicleId, [vehicleId+partTypeId+servicedAt], deletedAt',
    outbox: 'mutationId, entityId, [status+createdAt]',
    syncMeta: 'accountId',
    accountCache: 'id',
  });
  await legacy.open();
  const payload = { name: 'Historical 🔧', legacy_extra: ['must', 'survive'] };
  try {
    await legacy.table('vehicles').put({ id: 'v', accountId: 'a', serverSeq: 12 });
    await legacy.table('partTypes').bulkPut([
      { id: 'global-seed', code: 'oil', active: true },
      { id: 'owned', code: 'oil', accountId: 'a', active: true },
    ]);
    const row = (mutationId: string, status: string, createdAt: string, extra = {}) => ({
      mutationId,
      entityType: 'vehicle',
      entityId: 'v',
      operation: 'update',
      payload,
      status,
      createdAt,
      retryCount: 2,
      lastError: 'old error',
      ...extra,
    });
    await legacy.table('outbox').bulkPut([
      row('retry', 'retryable_error', '2026-01-01'),
      row('rejected', 'rejected', '2026-01-02', { baseServerSeq: 7 }),
      row('applied', 'applied', '2026-01-03'),
      row('pending', 'pending', '2026-01-04'),
      row('unowned', 'pending', '2026-01-05', { entityId: 'missing' }),
      row('global', 'pending', '2026-01-06', {
        entityType: 'part_type',
        entityId: 'global-seed',
      }),
    ]);
    await legacy.table('syncMeta').bulkPut([
      { accountId: 'a', deviceId: 'stable', lastSeenSeq: 5, bootstrapState: 'ready' },
      { accountId: 'empty', deviceId: 'other', lastSeenSeq: 0 },
    ]);
  } finally {
    legacy.close();
  }

  await db.open();
  expect(db.verno).toBe(9);
  const rows = await db.outbox.orderBy('localSeq').toArray();
  expect(
    rows.map(({ mutationId, localSeq, status, failureKind, baseServerSeq }) => ({
      mutationId,
      localSeq,
      status,
      failureKind,
      baseServerSeq,
    })),
  ).toEqual([
    { mutationId: 'retry', localSeq: 1, status: 'pending', failureKind: null, baseServerSeq: 12 },
    {
      mutationId: 'rejected',
      localSeq: 2,
      status: 'blocked',
      failureKind: 'terminal',
      baseServerSeq: 7,
    },
    // Historical migration reserves a sequence for acknowledged rows before deleting them.
    { mutationId: 'pending', localSeq: 4, status: 'pending', failureKind: null, baseServerSeq: 12 },
  ]);
  for (const row of rows) {
    expect(row.payload).toEqual(payload);
    expect(row.accountId).toBe('a');
    expect(row.retryCount).toBe(2);
    expect(row.lastError).toBe('old error');
  }
  expect(await db.partTypes.get('global-seed')).toBeUndefined();
  expect(await db.partTypes.get('owned')).toMatchObject({ code: 'oil', accountId: 'a' });
  expect(await db.syncMeta.get('a')).toMatchObject({
    deviceId: 'stable',
    lastSeenSeq: 5,
    nextLocalSeq: 5,
    bootstrapState: 'ready',
    operation: 'idle',
    lastSyncFailureKind: null,
  });
  expect(await db.syncMeta.get('empty')).toMatchObject({
    nextLocalSeq: 1,
    operation: 'idle',
    lastSyncFailureKind: null,
  });
  expect(db.outbox.schema.indexes.map((index) => index.name)).toEqual([
    'entityId',
    'accountId',
    'status',
    'localSeq',
    '[accountId+localSeq]',
    '[accountId+status+localSeq]',
  ]);
});
