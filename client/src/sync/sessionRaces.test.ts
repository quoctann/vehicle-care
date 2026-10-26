import Dexie from 'dexie';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as api from '@/api/client';
import { ApiError } from '@/api/errors';
import type { PullResponse } from '@/api/contract.types';
import { db } from '@/data/db';
import { clearAllTables } from '@/data/testUtils';
import { useSessionStore } from '@/stores/useSessionStore';
import { useSyncStore } from '@/stores/useSyncStore';
import { withAccountSyncLock } from './accountLock';
import { bootstrapSync } from './bootstrap';
import { pullChanges } from './pull';
import { pushOutbox } from './push';
import { restoreFromServer } from './restore';
import { runSync } from './syncOrchestrator';
import { captureSyncSession, expireSyncSession } from './sessionGuard';

vi.mock('@/api/client', () => ({
  registerDevice: vi.fn(),
  pushMutations: vi.fn(),
  pullChanges: vi.fn(),
}));

const account = {
  id: 'account-1',
  email: 'a@example.com',
  name: null,
  timezone: 'UTC+07:00',
  emailVerified: true,
};
const timestamp = '2026-10-25T00:00:00.000Z';
const expired = () =>
  new ApiError(
    { error: { code: 'session_expired', message: 'Expired', retryable: false, request_id: 'r' } },
    401,
  );

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function relogin() {
  useSessionStore.getState().clear();
  useSessionStore.getState().setAuthenticated(account);
}

function page(next = 0): PullResponse {
  return {
    account_id: account.id,
    changes: [],
    next_cursor: next,
    until_seq: next,
    has_more: false,
    server_time: timestamp,
  };
}

function change(seq: number) {
  return {
    entity_type: 'vehicle' as const,
    operation: 'create' as const,
    entity_id: `remote-${seq}`,
    payload: {
      name: `Remote ${seq}`,
      plate_number: null,
      archived_at: null,
      deleted_at: null,
      due_soon_ratio: null,
    },
    server_seq: seq,
    server_synced_at: timestamp,
  };
}

beforeEach(async () => {
  useSessionStore.getState().setAuthenticated(account);
  useSyncStore.setState({ status: 'idle', lastError: null, lastSyncedAt: null });
  await db.syncMeta.put({
    accountId: account.id,
    deviceId: 'stable-device',
    lastSeenSeq: 0,
    nextLocalSeq: 2,
    operation: 'idle',
    lastSyncedAt: null,
    lastSyncError: null,
    lastSyncFailureKind: null,
    bootstrapState: 'ready',
  });
  vi.mocked(api.registerDevice).mockResolvedValue({
    account_id: account.id,
    device_id: 'stable-device',
    registered_at: timestamp,
  });
  vi.mocked(api.pullChanges).mockResolvedValue(page());
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  useSessionStore.getState().clear();
  await clearAllTables();
});

async function seedMutation() {
  await db.vehicles.put({
    id: 'local',
    accountId: account.id,
    name: 'Offline',
    plateNumber: null,
    archivedAt: null,
    deletedAt: null,
    dueSoonRatio: null,
    createdAtClient: timestamp,
    serverSeq: null,
    serverSyncedAt: null,
  });
  await db.outbox.put({
    mutationId: 'immutable',
    accountId: account.id,
    localSeq: 1,
    entityType: 'vehicle',
    operation: 'create',
    entityId: 'local',
    payload: { name: 'Offline' },
    baseServerSeq: null,
    status: 'pending',
    retryCount: 0,
    lastError: null,
    failureKind: null,
    createdAt: timestamp,
  });
  vi.mocked(api.pushMutations).mockResolvedValue({
    account_id: account.id,
    results: [
      { mutation_id: 'immutable', status: 'applied', server_seq: 1, server_synced_at: timestamp },
    ],
  });
  return (await db.outbox.get('immutable'))!;
}

it.each([undefined, 'account-2'])(
  'rejects push response identity %s without ACK or metadata writes',
  async (identity) => {
    const original = await seedMutation();
    vi.mocked(api.pushMutations).mockResolvedValue({
      account_id: identity,
      results: [
        { mutation_id: 'immutable', status: 'applied', server_seq: 1, server_synced_at: timestamp },
      ],
    } as Awaited<ReturnType<typeof api.pushMutations>>);
    await expect(pushOutbox('stable-device', account.id)).rejects.toThrow(/account/);
    expect(await db.outbox.get(original.mutationId)).toEqual(original);
    expect(await db.vehicles.get('local')).toMatchObject({ serverSeq: null, serverSyncedAt: null });
  },
);

it.each([undefined, 'account-2'])(
  'rejects pull response identity %s before applying any records',
  async (identity) => {
    vi.mocked(api.pullChanges).mockResolvedValue({
      ...page(2),
      changes: [change(1), change(2)],
      account_id: identity,
    } as PullResponse);
    await expect(pullChanges(account.id)).rejects.toThrow(/account/);
    expect(await db.vehicles.count()).toBe(0);
    expect(await db.syncMeta.get(account.id)).toMatchObject({ lastSeenSeq: 0 });
  },
);

it('keeps a committed first page when the second page has another account identity', async () => {
  vi.mocked(api.pullChanges)
    .mockResolvedValueOnce({ ...page(1), until_seq: 2, has_more: true, changes: [change(1)] })
    .mockResolvedValueOnce({ ...page(2), account_id: 'account-2', changes: [change(2)] });
  await expect(pullChanges(account.id)).rejects.toThrow(/account/);
  expect(await db.vehicles.toArray()).toMatchObject([{ id: 'remote-1' }]);
  expect(await db.syncMeta.get(account.id)).toMatchObject({ lastSeenSeq: 1 });
});

it('rolls back ACK deletion AND entity metadata if relogin occurs after the metadata write', async () => {
  const original = await seedMutation();
  const update = db.vehicles.update.bind(db.vehicles);
  vi.spyOn(db.vehicles, 'update').mockImplementation((...args) =>
    update(...args).then((result) => {
      relogin();
      return result;
    }),
  );
  await expect(pushOutbox('stable-device', account.id)).rejects.toThrow(/changed/);
  expect(await db.outbox.get('immutable')).toEqual(original);
  expect(await db.vehicles.get('local')).toMatchObject({ serverSeq: null, serverSyncedAt: null });
});

it('rolls back the bootstrap cache replacement after its awaited write', async () => {
  await db.accountCache.put({
    id: 'current',
    accountId: 'account-2',
    email: 'b@example.com',
    name: null,
    timezone: account.timezone,
    emailVerified: true,
    deviceId: 'other-device',
    cachedAt: timestamp,
  });
  const before = await db.accountCache.get('current');
  const put = db.accountCache.put.bind(db.accountCache);
  vi.spyOn(db.accountCache, 'put').mockImplementation((...args) =>
    put(...args).then((result) => {
      relogin();
      return result;
    }),
  );
  await expect(bootstrapSync(account)).rejects.toThrow(/changed/);
  expect(await db.accountCache.get('current')).toEqual(before);
  expect(await db.syncMeta.get(account.id)).toMatchObject({
    nextLocalSeq: 2,
    lastSeenSeq: 0,
    deviceId: 'stable-device',
  });
});

it('rolls back multiple pulled records AND cursor if relogin occurs after the cursor write', async () => {
  vi.mocked(api.pullChanges).mockResolvedValue({ ...page(2), changes: [change(1), change(2)] });
  const update = db.syncMeta.update.bind(db.syncMeta);
  vi.spyOn(db.syncMeta, 'update').mockImplementation((...args) =>
    update(...args).then((result) => {
      relogin();
      return result;
    }),
  );
  await expect(pullChanges(account.id)).rejects.toThrow(/changed/);
  expect(await db.vehicles.count()).toBe(0);
  expect(await db.syncMeta.get(account.id)).toMatchObject({ lastSeenSeq: 0 });
});

it('rolls back restore initialization including deleted records/outbox after its final awaited write', async () => {
  const original = await seedMutation();
  const before = await db.syncMeta.get(account.id);
  const update = db.syncMeta.update.bind(db.syncMeta);
  vi.spyOn(db.syncMeta, 'update').mockImplementation((...args) =>
    update(...args).then((result) => {
      if ('lastSeenSeq' in args[1]) relogin();
      return result;
    }),
  );
  await expect(restoreFromServer(account.id)).rejects.toThrow(/changed/);
  expect(await db.outbox.get('immutable')).toEqual(original);
  expect(await db.vehicles.get('local')).toMatchObject({ name: 'Offline' });
  expect(await db.syncMeta.get(account.id)).toEqual(before);
  expect(api.pullChanges).not.toHaveBeenCalled();
});

it.each(['sync', 'restore'])(
  'captures generation before waiting for the actual account lock: %s',
  async (operation) => {
    const held = deferred<void>();
    const acquired = deferred<void>();
    const lock = withAccountSyncLock(account.id, async () => {
      acquired.resolve();
      await held.promise;
    });
    await acquired.promise;
    const before = await db.syncMeta.get(account.id);
    const old = operation === 'sync' ? runSync() : restoreFromServer(account.id);
    const rejected = expect(old).rejects.toThrow(/changed/);
    relogin();
    useSyncStore.getState().setSynced('new-generation');
    held.resolve();
    await lock;
    await rejected;
    expect(api.registerDevice).not.toHaveBeenCalled();
    expect(api.pullChanges).not.toHaveBeenCalled();
    expect(await db.syncMeta.get(account.id)).toEqual(before);
    expect(useSyncStore.getState()).toMatchObject({
      status: 'synced',
      lastSyncedAt: 'new-generation',
    });
  },
);

it('runs a fresh generation after the old lock releases and preserves its in-flight promise', async () => {
  const firstRequest = deferred<Awaited<ReturnType<typeof api.registerDevice>>>();
  const secondRequest = deferred<Awaited<ReturnType<typeof api.registerDevice>>>();
  vi.mocked(api.registerDevice)
    .mockReturnValueOnce(firstRequest.promise)
    .mockReturnValueOnce(secondRequest.promise);
  const old = runSync();
  const rejected = expect(old).rejects.toThrow(/changed/);
  await vi.waitFor(() => expect(api.registerDevice).toHaveBeenCalledTimes(1));
  relogin();
  const fresh = runSync();
  expect(fresh).not.toBe(old);
  expect(runSync()).toBe(fresh);
  firstRequest.resolve({
    account_id: account.id,
    device_id: 'stable-device',
    registered_at: timestamp,
  });
  await rejected;
  await vi.waitFor(() => expect(api.registerDevice).toHaveBeenCalledTimes(2));
  expect(runSync()).toBe(fresh);
  secondRequest.resolve({
    account_id: account.id,
    device_id: 'stable-device',
    registered_at: timestamp,
  });
  await fresh;
  expect(api.pullChanges).toHaveBeenCalledOnce();
  expect(useSyncStore.getState().status).toBe('synced');
});

it.each(['success', '401'])(
  'stale restore %s cannot overwrite the new session or UI',
  async (completion) => {
    const request = deferred<PullResponse>();
    vi.mocked(api.pullChanges).mockReturnValueOnce(request.promise);
    const old = restoreFromServer(account.id);
    const rejected = expect(old).rejects.toThrow();
    await vi.waitFor(() => expect(api.pullChanges).toHaveBeenCalled());
    relogin();
    useSyncStore.getState().setSynced('new-generation');
    const before = await db.syncMeta.get(account.id);
    if (completion === 'success') request.resolve(page());
    else request.reject(expired());
    await rejected;
    expect(await db.syncMeta.get(account.id)).toEqual(before);
    expect(useSessionStore.getState().status).toBe('authenticated');
    expect(useSyncStore.getState()).toMatchObject({
      status: 'synced',
      lastSyncedAt: 'new-generation',
    });
  },
);

it('does not terminalize or alter the immutable queue on stale-account HTTP 409', async () => {
  const original = await seedMutation();
  vi.mocked(api.pushMutations).mockRejectedValue(
    new ApiError(
      {
        error: {
          code: 'validation_failed',
          message: 'The session changed. Refresh and try again.',
          retryable: false,
          request_id: 'r',
        },
      },
      409,
    ),
  );
  await expect(runSync()).rejects.toThrow(/Refresh/);
  expect(await db.outbox.get(original.mutationId)).toEqual(original);
  expect(api.pullChanges).not.toHaveBeenCalled();
  expect(useSessionStore.getState().account?.id).toBe(account.id);
});

it('rechecks generation after paused 401 cache cleanup and rolls its deletion back', async () => {
  await db.accountCache.put({
    id: 'current',
    accountId: account.id,
    email: account.email,
    name: null,
    timezone: account.timezone,
    emailVerified: true,
    deviceId: 'stable-device',
    cachedAt: timestamp,
  });
  const before = await db.accountCache.get('current');
  const deleted = deferred<void>();
  const release = deferred<void>();
  const remove = db.accountCache.delete.bind(db.accountCache);
  vi.spyOn(db.accountCache, 'delete').mockImplementation((key) =>
    remove(key).then(async () => {
      deleted.resolve();
      await Dexie.waitFor(release.promise);
    }),
  );
  const cleanup = expireSyncSession(expired(), captureSyncSession(account.id));
  await deleted.promise;
  relogin();
  const generation = useSessionStore.getState().sessionGeneration;
  release.resolve();
  await cleanup;
  expect(await db.accountCache.get('current')).toEqual(before);
  expect(useSessionStore.getState()).toMatchObject({
    status: 'authenticated',
    sessionGeneration: generation,
  });
});

it('current-session 401 clears only the profile cache and preserves entities and outbox', async () => {
  const original = await seedMutation();
  await db.accountCache.put({
    id: 'current',
    accountId: account.id,
    email: account.email,
    name: null,
    timezone: account.timezone,
    emailVerified: true,
    deviceId: 'stable-device',
    cachedAt: timestamp,
  });
  vi.mocked(api.pushMutations).mockRejectedValue(expired());
  await expect(runSync()).rejects.toThrow('Expired');
  expect(useSessionStore.getState().status).toBe('anonymous');
  expect(await db.accountCache.get('current')).toBeUndefined();
  expect(await db.outbox.get(original.mutationId)).toEqual(original);
  expect(await db.vehicles.get('local')).toMatchObject({ name: 'Offline' });
});

it('auth cleanup never deletes a different account cached by another tab', async () => {
  await db.accountCache.put({
    id: 'current',
    accountId: 'account-2',
    email: 'b@example.com',
    name: null,
    timezone: account.timezone,
    emailVerified: true,
    deviceId: 'other-device',
    cachedAt: timestamp,
  });
  const before = await db.accountCache.get('current');
  await expireSyncSession(expired(), captureSyncSession(account.id));
  expect(await db.accountCache.get('current')).toEqual(before);
  expect(useSessionStore.getState().status).toBe('anonymous');
});

it('a cache cleanup failure does not replace the original auth error', async () => {
  const original = await seedMutation();
  vi.spyOn(db.accountCache, 'get').mockRejectedValue(new Error('cache unavailable'));
  vi.mocked(api.pushMutations).mockRejectedValue(expired());
  await expect(runSync()).rejects.toThrow('Expired');
  expect(useSessionStore.getState().status).toBe('anonymous');
  expect(await db.outbox.get(original.mutationId)).toEqual(original);
});
