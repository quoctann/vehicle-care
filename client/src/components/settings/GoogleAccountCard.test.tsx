// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useSessionStore } from '@/stores/useSessionStore';
import { beginGoogleLink, loadGoogleStatus } from '@/lib/googleAccount';
import { GoogleAccountCard } from './GoogleAccountCard';

const { t } = vi.hoisted(() => ({ t: (key: string) => key }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t }) }));
vi.mock('@/lib/googleAccount', () => ({ beginGoogleLink: vi.fn(), loadGoogleStatus: vi.fn() }));
const account = {
  id: 'account-a',
  email: 'a@test.invalid',
  name: null,
  timezone: 'UTC+07:00',
  emailVerified: true,
};
const status = { enabled: true, linked: false, has_password: true };

beforeEach(() => {
  useSessionStore.getState().setAuthenticated(account);
  vi.stubGlobal('navigator', { onLine: true });
  vi.mocked(loadGoogleStatus).mockResolvedValue(status);
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

it.each([
  [{ ...status, enabled: false }, 'google.errors.unavailable'],
  [{ ...status, linked: true, has_password: false }, 'google.linked'],
  [{ ...status, has_password: false }, 'google.noPassword'],
])('only offers password linking when eligible: %s', async (value, message) => {
  vi.mocked(loadGoogleStatus).mockResolvedValue(value);
  render(<GoogleAccountCard accountId={account.id} />);
  expect(await screen.findByText(message)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'google.link' })).toBeNull();
});

it('does not fetch offline; checks fresh status after reconnecting', async () => {
  vi.stubGlobal('navigator', { onLine: false });
  render(<GoogleAccountCard accountId={account.id} />);
  expect(screen.getByText('google.offline')).toBeTruthy();
  expect(loadGoogleStatus).not.toHaveBeenCalled();
  vi.stubGlobal('navigator', { onLine: true });
  fireEvent(window, new Event('online'));
  expect(await screen.findByRole('button', { name: 'google.link' })).toBeTruthy();
});

it('retries status failure without blocking the rest of settings', async () => {
  vi.mocked(loadGoogleStatus).mockRejectedValueOnce(new Error('network'));
  render(<GoogleAccountCard accountId={account.id} />);
  expect(await screen.findByRole('alert')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'google.retry' }));
  expect(await screen.findByRole('button', { name: 'google.link' })).toBeTruthy();
});

it('cancels password confirmation, clears secrets and requires fresh entry', async () => {
  render(<GoogleAccountCard accountId={account.id} />);
  fireEvent.click(await screen.findByRole('button', { name: 'google.link' }));
  fireEvent.change(screen.getByLabelText('google.password'), { target: { value: 'secret' } });
  fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }));
  fireEvent.click(screen.getByRole('button', { name: 'google.link' }));
  expect((screen.getByLabelText('google.password') as HTMLInputElement).value).toBe('');
  expect(beginGoogleLink).not.toHaveBeenCalled();
});

it('clears the password on failure and can retry with a new password', async () => {
  vi.mocked(beginGoogleLink).mockRejectedValue(new Error('failure'));
  render(<GoogleAccountCard accountId={account.id} />);
  fireEvent.click(await screen.findByRole('button', { name: 'google.link' }));
  fireEvent.change(screen.getByLabelText('google.password'), { target: { value: 'secret' } });
  fireEvent.click(screen.getByRole('button', { name: 'google.confirm' }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect((screen.getByLabelText('google.password') as HTMLInputElement).value).toBe('');
  expect(beginGoogleLink).toHaveBeenCalledWith(
    expect.objectContaining({ accountId: account.id }),
    'secret',
  );
  vi.stubGlobal('navigator', { onLine: false });
  fireEvent(window, new Event('offline'));
  expect(screen.queryByLabelText('google.password')).toBeNull();
});

it('ignores a status response after unmount or account generation changes', async () => {
  let resolve!: (value: typeof status) => void;
  vi.mocked(loadGoogleStatus).mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const view = render(<GoogleAccountCard accountId={account.id} />);
  useSessionStore.getState().setAuthenticated(account);
  resolve(status);
  await waitFor(() => expect(screen.queryByRole('button', { name: 'google.link' })).toBeNull());
  view.unmount();
});

it('does not submit an old password form after a same-account relogin', async () => {
  render(<GoogleAccountCard accountId={account.id} />);
  fireEvent.click(await screen.findByRole('button', { name: 'google.link' }));
  fireEvent.change(screen.getByLabelText('google.password'), { target: { value: 'secret' } });
  useSessionStore.getState().setAuthenticated(account);
  fireEvent.click(screen.getByRole('button', { name: 'google.confirm' }));
  expect(beginGoogleLink).not.toHaveBeenCalled();
});

it.each(['switch', 'relogin', 'unmount'] as const)(
  'never navigates when a deferred link resolves after %s',
  async (change) => {
    const navigate = vi.fn();
    const originalWindow = window;
    vi.stubGlobal(
      'window',
      new Proxy(originalWindow, {
        get(target, key) {
          return key === 'location' ? { assign: navigate } : Reflect.get(target, key);
        },
      }),
    );
    let resolve!: (url: string) => void;
    const deferred = new Promise<string>((finish) => {
      resolve = finish;
    });
    vi.mocked(beginGoogleLink).mockReturnValue(deferred);
    const view = render(<GoogleAccountCard accountId={account.id} />);
    fireEvent.click(await screen.findByRole('button', { name: 'google.link' }));
    fireEvent.change(screen.getByLabelText('google.password'), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'google.confirm' }));
    expect(beginGoogleLink).toHaveBeenCalledOnce();
    if (change === 'unmount') view.unmount();
    else
      useSessionStore
        .getState()
        .setAuthenticated({ ...account, id: change === 'switch' ? 'account-b' : account.id });
    // act waits for the deferred consumer, including submit's finally, rather
    // than asserting absence while the response is still unresolved.
    await act(async () => {
      resolve('https://accounts.google.com/o/oauth2/v2/auth?state=stale');
      await deferred;
    });
    expect(navigate).not.toHaveBeenCalled();
  },
);
