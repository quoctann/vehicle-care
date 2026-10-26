import { afterEach, expect, it, vi } from 'vitest';
import * as api from '@/api/client';
import { db } from '@/data/db';
import { clearAllTables } from '@/data/testUtils';
import { useSessionStore } from '@/stores/useSessionStore';
import { bootstrapSync } from './bootstrap';

vi.mock('@/api/client', () => ({ registerDevice: vi.fn() }));

const account = {
  id: 'account-1',
  email: 'a@example.com',
  name: null,
  timezone: 'UTC',
  emailVerified: true,
};

afterEach(async () => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  useSessionStore.getState().clear();
  await clearAllTables();
});

it('caches the latest session profile rather than the captured bootstrap account', async () => {
  useSessionStore.getState().setAuthenticated(account);
  vi.stubGlobal('localStorage', { getItem: () => 'device-1', setItem: vi.fn() });
  vi.mocked(api.registerDevice).mockImplementation(async () => {
    // Profile updates do not represent a new login/session generation.
    useSessionStore.setState({ account: { ...account, timezone: 'Asia/Tokyo' } });
    return {
      account_id: account.id,
      device_id: 'device-1',
      registered_at: new Date().toISOString(),
    };
  });
  await bootstrapSync(account);
  expect(await db.accountCache.get('current')).toMatchObject({ timezone: 'Asia/Tokyo' });
});

it.each([undefined, 'another-account'])(
  'rejects registration identity %s before caching',
  async (identity) => {
    useSessionStore.getState().setAuthenticated(account);
    vi.stubGlobal('localStorage', { getItem: () => 'device-1', setItem: vi.fn() });
    vi.mocked(api.registerDevice).mockResolvedValue({
      account_id: identity,
      device_id: 'device-1',
      registered_at: new Date().toISOString(),
    } as Awaited<ReturnType<typeof api.registerDevice>>);
    await expect(bootstrapSync(account)).rejects.toThrow(/account/i);
    expect(await db.accountCache.get('current')).toBeUndefined();
  },
);

it.each(['switch', 'relogin'])('does not cache a bootstrap result after %s', async (change) => {
  useSessionStore.getState().setAuthenticated(account);
  vi.stubGlobal('localStorage', { getItem: () => 'device-1', setItem: vi.fn() });
  vi.mocked(api.registerDevice).mockImplementation(async () => {
    useSessionStore.getState().clear();
    useSessionStore
      .getState()
      .setAuthenticated({ ...account, id: change === 'switch' ? 'account-2' : account.id });
    return {
      account_id: account.id,
      device_id: 'device-1',
      registered_at: new Date().toISOString(),
    };
  });
  await expect(bootstrapSync(account)).rejects.toThrow(/changed/i);
  expect(await db.accountCache.get('current')).toBeUndefined();
});

it('aborts cache writes if the session changes inside the bootstrap transaction', async () => {
  useSessionStore.getState().setAuthenticated(account);
  vi.stubGlobal('localStorage', { getItem: () => 'device-1', setItem: vi.fn() });
  vi.mocked(api.registerDevice).mockResolvedValue({
    account_id: account.id,
    device_id: 'device-1',
    registered_at: new Date().toISOString(),
  });
  const put = db.accountCache.put.bind(db.accountCache);
  const spy = vi.spyOn(db.accountCache, 'put').mockImplementation((...args) =>
    put(...args).then((result) => {
      useSessionStore.getState().clear();
      return result;
    }),
  );
  try {
    await expect(bootstrapSync(account)).rejects.toThrow(/changed/i);
    expect(await db.accountCache.get('current')).toBeUndefined();
  } finally {
    spy.mockRestore();
  }
});

it('does not move nextLocalSeq backwards when a local write happens during device registration', async () => {
  useSessionStore.getState().setAuthenticated(account);
  await db.syncMeta.put({
    accountId: account.id,
    deviceId: 'device-1',
    lastSeenSeq: 0,
    nextLocalSeq: 10,
    operation: 'idle',
    lastSyncedAt: null,
    lastSyncError: null,
    lastSyncFailureKind: null,
    bootstrapState: 'ready',
  });
  let finishRegistration!: () => void;
  vi.mocked(api.registerDevice).mockImplementation(
    () =>
      new Promise((resolve) => {
        finishRegistration = () =>
          resolve({
            account_id: account.id,
            device_id: 'device-1',
            registered_at: new Date().toISOString(),
          });
      }),
  );

  const bootstrap = bootstrapSync(account);
  await vi.waitFor(() => expect(api.registerDevice).toHaveBeenCalled());
  await db.syncMeta.update(account.id, { nextLocalSeq: 11 });
  finishRegistration();
  await bootstrap;

  expect(await db.syncMeta.get(account.id)).toMatchObject({ nextLocalSeq: 11 });
});

it('preserves the IndexedDB device identity when localStorage has been cleared or replaced', async () => {
  useSessionStore.getState().setAuthenticated(account);
  vi.stubGlobal('localStorage', { getItem: () => 'different-device', setItem: vi.fn() });
  await db.syncMeta.put({
    accountId: account.id,
    deviceId: 'original-device',
    lastSeenSeq: 10,
    nextLocalSeq: 2,
    operation: 'idle',
    lastSyncedAt: null,
    lastSyncError: null,
    lastSyncFailureKind: null,
    bootstrapState: 'ready',
  });
  vi.mocked(api.registerDevice).mockResolvedValue({
    account_id: account.id,
    device_id: 'original-device',
    registered_at: new Date().toISOString(),
  });

  expect(await bootstrapSync(account)).toEqual({
    accountId: account.id,
    deviceId: 'original-device',
  });
  expect(api.registerDevice).toHaveBeenCalledWith(
    expect.objectContaining({ device_id: 'original-device' }),
  );
  expect(await db.syncMeta.get(account.id)).toMatchObject({ deviceId: 'original-device' });
});
