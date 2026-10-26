import { afterEach, expect, it, vi } from 'vitest';
import { pullChanges, pushMutations, registerDevice } from './client';
import * as api from './client';

afterEach(() => vi.unstubAllGlobals());

it('gets Google status with account precondition and links using CSRF and password reauthentication', async () => {
  vi.stubGlobal('document', { cookie: 'csrf_token=google-csrf' });
  const fetcher = vi
    .fn()
    .mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ enabled: true, linked: false, has_password: true }),
    });
  vi.stubGlobal('fetch', fetcher);
  expect(await api.getGoogleStatus('account-a')).toEqual({
    enabled: true,
    linked: false,
    has_password: true,
  });
  await api.linkGoogle({ password: 'reauth-password', expected_account_id: 'account-a' });
  expect(fetcher.mock.calls[0][0]).toMatch(
    /\/auth\/google\/status\?expected_account_id=account-a$/,
  );
  expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'GET', credentials: 'include' });
  expect(fetcher.mock.calls[1][1]).toMatchObject({
    method: 'POST',
    credentials: 'include',
    headers: { 'X-CSRF-Token': 'google-csrf' },
    body: JSON.stringify({ password: 'reauth-password', expected_account_id: 'account-a' }),
  });
});

it('transmits the required expected account in register/push JSON and pull query', async () => {
  const fetcher = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ account_id: 'captured-account' }),
  });
  vi.stubGlobal('fetch', fetcher);
  vi.stubGlobal('document', { cookie: 'csrf_token=csrf-test' });
  await registerDevice({
    expected_account_id: 'captured-account',
    device_id: 'device',
    platform: 'web',
    app_version: 'test',
  });
  await pushMutations({
    expected_account_id: 'captured-account',
    device_id: 'device',
    mutations: [],
  });
  await pullChanges({
    expectedAccountId: 'captured-account',
    afterSeq: 1,
    untilSeq: 9,
    limit: 100,
  });
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({
    expected_account_id: 'captured-account',
  });
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({
    expected_account_id: 'captured-account',
  });
  const query = new URL(fetcher.mock.calls[2][0], 'https://test.invalid').searchParams;
  expect(Object.fromEntries(query)).toEqual({
    expected_account_id: 'captured-account',
    after_seq: '1',
    until_seq: '9',
    limit: '100',
  });
  for (const [, options] of fetcher.mock.calls) expect(options.credentials).toBe('include');
  expect(fetcher.mock.calls[0][1].headers['X-CSRF-Token']).toBe('csrf-test');
});

it('retains auth/catalog HTTP methods and handles empty and failed responses', async () => {
  vi.stubGlobal('document', { cookie: '' });
  const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 204 });
  vi.stubGlobal('fetch', fetcher);
  await api.signup({ email: 'a@example.com', password: 'password' });
  await api.verifyEmail({ token: 'test' });
  await api.resendVerificationEmail({ email: 'a@example.com' });
  await api.login({ email: 'a@example.com', password: 'password' });
  await api.forgotPassword({ email: 'a@example.com' });
  await api.resetPassword({ token: 'test', new_password: 'password' });
  await api.getSession();
  await api.updateAccountTimezone({ timezone: 'UTC+07:00', expected_account_id: 'a' });
  await api.listPartTypes();
  await api.logout();
  expect(api.googleStartUrl()).toMatch(/\/auth\/google\/start$/);
  expect(fetcher.mock.calls[6][1].method).toBe('GET');
  expect(fetcher.mock.calls[8][1].method).toBe('GET');
  fetcher.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        error: { code: 'session_expired', message: 'Expired', retryable: false, request_id: 'r' },
      }),
      { status: 401 },
    ),
  );
  await expect(api.getSession()).rejects.toThrow('Expired');
});
