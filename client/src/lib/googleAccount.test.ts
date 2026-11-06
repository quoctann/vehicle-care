import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as api from '@/api/client';
import { useSessionStore } from '@/stores/useSessionStore';
import { captureSyncSession } from '@/sync/sessionGuard';
import { beginGoogleLink, loadGoogleStatus } from './googleAccount';

vi.mock('@/api/client', () => ({ getGoogleStatus: vi.fn(), linkGoogle: vi.fn() }));
const account = {
  id: 'account-a',
  email: 'a@test.invalid',
  name: null,
  timezone: 'UTC+07:00',
  emailVerified: true,
};
beforeEach(() => useSessionStore.getState().setAuthenticated(account));
afterEach(() => vi.resetAllMocks());

it('loads validated status for the captured account', async () => {
  vi.mocked(api.getGoogleStatus).mockResolvedValue({
    enabled: false,
    linked: false,
    has_password: true,
  });
  expect(await loadGoogleStatus(captureSyncSession(account.id))).toEqual({
    enabled: false,
    linked: false,
    has_password: true,
  });
  expect(api.getGoogleStatus).toHaveBeenCalledWith(account.id);
});

it.each(['switch', 'relogin', 'logout'])(
  'rejects a late status response after %s',
  async (change) => {
    let resolve!: (value: api.GoogleStatusResponse) => void;
    vi.mocked(api.getGoogleStatus).mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const request = loadGoogleStatus(captureSyncSession(account.id));
    if (change === 'logout') useSessionStore.getState().clear();
    else
      useSessionStore
        .getState()
        .setAuthenticated({ ...account, id: change === 'switch' ? 'account-b' : account.id });
    resolve({ enabled: true, linked: true, has_password: false });
    await expect(request).rejects.toThrow();
  },
);

it('rejects malformed status and unsafe link URLs', async () => {
  vi.mocked(api.getGoogleStatus).mockResolvedValue({ enabled: 'yes' } as never);
  await expect(loadGoogleStatus(captureSyncSession(account.id))).rejects.toThrow();
  vi.mocked(api.linkGoogle).mockResolvedValue({ authorization_url: 'https://evil.test/' });
  await expect(beginGoogleLink(captureSyncSession(account.id), 'password')).rejects.toThrow();
});

it('passes the password unchanged and expected account, returning a trusted URL', async () => {
  const authorization_url = 'https://accounts.google.com/o/oauth2/v2/auth?state=test';
  vi.mocked(api.linkGoogle).mockResolvedValue({ authorization_url });
  expect(await beginGoogleLink(captureSyncSession(account.id), ' password ')).toBe(
    authorization_url,
  );
  expect(api.linkGoogle).toHaveBeenCalledWith({
    password: ' password ',
    expected_account_id: account.id,
  });
});

it('never starts a link for a stale session and suppresses a late link response', async () => {
  const context = captureSyncSession(account.id);
  useSessionStore.getState().setAuthenticated(account);
  await expect(beginGoogleLink(context, 'password')).rejects.toThrow();
  expect(api.linkGoogle).not.toHaveBeenCalled();
  let resolve!: (value: { authorization_url: string }) => void;
  vi.mocked(api.linkGoogle).mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const request = beginGoogleLink(captureSyncSession(account.id), 'password');
  useSessionStore.getState().clear();
  resolve({ authorization_url: 'https://accounts.google.com/o/oauth2/v2/auth' });
  await expect(request).rejects.toThrow();
});
