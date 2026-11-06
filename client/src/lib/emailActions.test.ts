import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '@/api/client';
import { useSessionStore } from '@/stores/useSessionStore';
import { ApiError } from '@/api/errors';
import { db } from '@/data/db';
import { parseEmailActionLink, isValidPassword, refreshEmailActionSession } from './emailActions';

vi.mock('@/api/client', () => ({ getSession: vi.fn() }));
const account = {
  id: 'account-a',
  email: 'a@example.test',
  name: null,
  timezone: 'UTC+07:00',
  emailVerified: false,
};
const dto = { ...account, email_verified: true };

beforeEach(async () => {
  vi.resetAllMocks();
  useSessionStore.getState().clear();
  await Promise.all([db.accountCache.clear(), db.vehicles.clear(), db.outbox.clear()]);
  await db.accountCache.put({
    id: 'current',
    accountId: account.id,
    email: account.email,
    name: null,
    timezone: account.timezone,
    emailVerified: false,
    deviceId: 'device-a',
    cachedAt: new Date().toISOString(),
  });
});

describe('email action links', () => {
  it('prefers fragments and removes every token from the URL', () => {
    expect(parseEmailActionLink('/verify-email?token=legacy&next=keep#token=private')).toEqual({
      token: 'private',
      cleanUrl: '/verify-email?next=keep',
    });
  });
  it('supports legacy query links and rejects ambiguous repeated tokens', () => {
    expect(parseEmailActionLink('/reset-password?token=old')).toEqual({
      token: 'old',
      cleanUrl: '/reset-password',
    });
    expect(parseEmailActionLink('/verify-email#token=a&token=b').token).toBe('');
    expect(parseEmailActionLink('/verify-email').token).toBe('');
  });
  it('validates UTF-8 bytes, not JS characters', () => {
    expect(isValidPassword('1234567')).toBe(false);
    expect(isValidPassword('😀😀')).toBe(true);
    expect(isValidPassword('a'.repeat(72))).toBe(true);
    expect(isValidPassword('a'.repeat(73))).toBe(false);
    expect(isValidPassword('😀'.repeat(19))).toBe(false);
  });
});

describe('guarded email action session refresh', () => {
  it('refreshes only the captured account without creating a new login', async () => {
    useSessionStore.getState().setAuthenticated(account);
    const context = useSessionStore.getState();
    vi.mocked(api.getSession).mockResolvedValue({ account: dto });
    await refreshEmailActionSession(context, false);
    expect(useSessionStore.getState().account?.emailVerified).toBe(true);
    expect(useSessionStore.getState().sessionGeneration).toBe(context.sessionGeneration);
    expect((await db.accountCache.get('current'))?.emailVerified).toBe(true);
  });
  it('does not adopt a different cookie account', async () => {
    useSessionStore.getState().setAuthenticated(account);
    vi.mocked(api.getSession).mockResolvedValue({ account: { ...dto, id: 'account-b' } });
    await refreshEmailActionSession(useSessionStore.getState(), true);
    expect(useSessionStore.getState().account).toEqual(account);
  });
  it('ignores late responses after re-login, including the same account', async () => {
    useSessionStore.getState().setAuthenticated(account);
    const context = useSessionStore.getState();
    let reject!: (error: unknown) => void;
    vi.mocked(api.getSession).mockReturnValue(
      new Promise((_, r) => {
        reject = r;
      }),
    );
    const pending = refreshEmailActionSession(context, true);
    useSessionStore.getState().setAuthenticated(account);
    reject(
      new ApiError(
        {
          error: {
            code: 'session_expired',
            message: 'Expired',
            retryable: false,
            request_id: 'test',
          },
        },
        401,
      ),
    );
    await pending;
    expect(useSessionStore.getState().account).toEqual(account);
  });
  it('clears only a current expired session after reset, not verification', async () => {
    useSessionStore.getState().setAuthenticated(account);
    vi.mocked(api.getSession).mockRejectedValue(
      new ApiError(
        {
          error: {
            code: 'session_expired',
            message: 'Expired',
            retryable: false,
            request_id: 'test',
          },
        },
        401,
      ),
    );
    await refreshEmailActionSession(useSessionStore.getState(), false);
    expect(useSessionStore.getState().account).toEqual(account);
    await refreshEmailActionSession(useSessionStore.getState(), true);
    expect(useSessionStore.getState().status).toBe('anonymous');
  });
  it('does not hydrate an anonymous session or clear on network failure', async () => {
    await refreshEmailActionSession(useSessionStore.getState(), true);
    expect(api.getSession).not.toHaveBeenCalled();
    useSessionStore.getState().setAuthenticated(account);
    vi.mocked(api.getSession).mockRejectedValue(new TypeError('offline'));
    await refreshEmailActionSession(useSessionStore.getState(), true);
    expect(useSessionStore.getState().account).toEqual(account);
  });

  it('late successful verification cannot change a newer account or cached profile', async () => {
    useSessionStore.getState().setAuthenticated(account);
    const context = useSessionStore.getState();
    let resolve!: (value: Awaited<ReturnType<typeof api.getSession>>) => void;
    vi.mocked(api.getSession).mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const pending = refreshEmailActionSession(context, false);
    useSessionStore.getState().setAuthenticated({ ...account, id: 'account-b' });
    resolve({ account: dto });
    await pending;
    expect(useSessionStore.getState().account?.id).toBe('account-b');
    expect((await db.accountCache.get('current'))?.emailVerified).toBe(false);
  });

  it('reset session expiry preserves every local entity and immutable outbox item', async () => {
    const timestamp = '2026-10-26T00:00:00Z';
    const vehicle = {
      id: 'vehicle-a',
      accountId: account.id,
      name: 'Offline draft',
      plateNumber: null,
      archivedAt: null,
      deletedAt: null,
      dueSoonRatio: null,
      createdAtClient: timestamp,
      serverSyncedAt: null,
      serverSeq: null,
    };
    const mutation = {
      mutationId: 'mutation-a',
      accountId: account.id,
      localSeq: 1,
      entityType: 'vehicle' as const,
      operation: 'create' as const,
      entityId: vehicle.id,
      payload: { name: vehicle.name },
      baseServerSeq: null,
      status: 'pending' as const,
      retryCount: 0,
      lastError: null,
      failureKind: null,
      createdAt: timestamp,
    };
    await db.vehicles.put(vehicle);
    await db.outbox.put(mutation);
    useSessionStore.getState().setAuthenticated(account);
    vi.mocked(api.getSession).mockRejectedValue(
      new ApiError(
        {
          error: {
            code: 'session_expired',
            message: 'Expired',
            retryable: false,
            request_id: 'test',
          },
        },
        401,
      ),
    );
    await refreshEmailActionSession(useSessionStore.getState(), true);
    expect(useSessionStore.getState().status).toBe('anonymous');
    expect(await db.vehicles.get(vehicle.id)).toEqual(vehicle);
    expect(await db.outbox.get(mutation.mutationId)).toEqual(mutation);
  });

  it('old reset invalidation cannot cancel hydration for a newer login', async () => {
    useSessionStore.getState().setAuthenticated(account);
    const generation = useSessionStore.getState().sessionGeneration;
    useSessionStore.getState().setAuthenticated({ ...account, id: 'account-b' });
    let resolve!: (value: Awaited<ReturnType<typeof api.getSession>>) => void;
    vi.mocked(api.getSession).mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const hydration = useSessionStore.getState().hydrate();
    useSessionStore.getState().invalidatePendingHydration(generation);
    resolve({ account: { ...dto, id: 'account-b' } });
    await hydration;
    expect(useSessionStore.getState().account?.emailVerified).toBe(true);
  });

  it('initial reset reconciliation preserves a live unrelated cookie account', async () => {
    useSessionStore.setState({ status: 'loading', account: null });
    const context = useSessionStore.getState();
    context.invalidatePendingHydration(context.sessionGeneration);
    vi.mocked(api.getSession).mockResolvedValue({ account: { ...dto, id: 'unrelated-account' } });
    await refreshEmailActionSession(context, true);
    expect(useSessionStore.getState().account?.id).toBe('unrelated-account');
    expect(useSessionStore.getState().status).toBe('authenticated');
  });
});
