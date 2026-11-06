// @vitest-environment jsdom
import { StrictMode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Link, MemoryRouter, useLocation } from 'react-router-dom';
import '@/i18n';
import { vi as locale } from '@/i18n/locales/vi';
import * as api from '@/api/client';
import { ApiError } from '@/api/errors';
import { useSessionStore } from '@/stores/useSessionStore';
import { VerifyEmailPage } from './VerifyEmailPage';
import { ResetPasswordPage } from './ResetPasswordPage';
import { ForgotPasswordPage } from './ForgotPasswordPage';

vi.mock('@/api/client', () => ({
  verifyEmail: vi.fn(),
  resetPassword: vi.fn(),
  resendVerificationEmail: vi.fn(),
  forgotPassword: vi.fn(),
  getSession: vi.fn(),
}));
const text = locale.translation;
afterEach(cleanup);
beforeEach(() => {
  vi.resetAllMocks();
  useSessionStore.getState().clear();
});

function Location() {
  const location = useLocation();
  return (
    <>
      <span aria-label="location">{location.pathname + location.search + location.hash}</span>
      <Link to={`${location.pathname}#token=replacement`}>replacement link</Link>
    </>
  );
}
function show(page: React.ReactNode, path: string) {
  render(
    <StrictMode>
      <MemoryRouter initialEntries={[path]}>
        {page}
        <Location />
      </MemoryRouter>
    </StrictMode>,
  );
}
const invalidLink = new ApiError(
  {
    error: { code: 'validation_failed', message: 'Invalid', retryable: false, request_id: 'test' },
  },
  400,
);

it('strips tokens in StrictMode without consuming them until confirmation', async () => {
  vi.mocked(api.verifyEmail).mockResolvedValue({ status: 'verified' });
  show(<VerifyEmailPage />, '/verify-email?token=legacy&next=keep#token=private');
  expect(screen.getByLabelText('location').textContent).toBe('/verify-email?next=keep');
  expect(api.verifyEmail).not.toHaveBeenCalled();
  const confirm = screen.getByRole('button', { name: text.auth.verifyConfirm });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe(text.auth.verifySuccess));
  expect(api.verifyEmail).toHaveBeenCalledExactlyOnceWith({ token: 'private' });
  expect(api.getSession).not.toHaveBeenCalled();
});

it('expired/replayed verification offers generic resend recovery and cooldown', async () => {
  vi.mocked(api.verifyEmail).mockRejectedValue(invalidLink);
  vi.mocked(api.resendVerificationEmail).mockResolvedValue(undefined);
  show(<VerifyEmailPage />, '/verify-email#token=expired');
  fireEvent.click(screen.getByRole('button', { name: text.auth.verifyConfirm }));
  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toBe(text.auth.invalidVerificationLink),
  );
  fireEvent.change(screen.getByLabelText(text.common.email), {
    target: { value: 'unknown@example.test' },
  });
  const form = screen.getByRole('button', { name: text.auth.resendEmail }).closest('form')!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe(text.auth.resent));
  expect(api.resendVerificationEmail).toHaveBeenCalledExactlyOnceWith({
    email: 'unknown@example.test',
  });
  expect(screen.getByRole('button', { name: /30/ }).hasAttribute('disabled')).toBe(true);
  await waitFor(
    () => expect(screen.getByRole('button', { name: /29/ }).hasAttribute('disabled')).toBe(true),
    { timeout: 2000 },
  );
});

it('missing verification/reset tokens never POST and expose recovery', () => {
  show(<VerifyEmailPage />, '/verify-email');
  expect(screen.getByRole('alert').textContent).toBe(text.auth.invalidVerificationLink);
  expect(api.verifyEmail).not.toHaveBeenCalled();
  cleanup();
  show(<ResetPasswordPage />, '/reset-password');
  expect(screen.getByRole('alert').textContent).toBe(text.auth.invalidResetLink);
  expect(screen.getByRole('link', { name: text.auth.sendResetLink }).getAttribute('href')).toBe(
    '/forgot-password',
  );
  expect(api.resetPassword).not.toHaveBeenCalled();
});

it('reset validates UTF8 bytes and confirmation and prevents repeat submission', async () => {
  vi.mocked(api.resetPassword).mockResolvedValue({ status: 'reset' });
  show(<ResetPasswordPage />, '/reset-password#token=private');
  expect(screen.getByLabelText('location').textContent).toBe('/reset-password');
  const password = screen.getByLabelText(text.auth.newPassword);
  const confirmation = screen.getByLabelText(text.auth.confirmNewPassword);
  const form = password.closest('form')!;
  fireEvent.change(password, { target: { value: '😀'.repeat(19) } });
  fireEvent.submit(form);
  expect(screen.getByRole('alert').textContent).toBe(text.auth.passwordBytes);
  fireEvent.change(password, { target: { value: '😀😀' } });
  fireEvent.submit(form);
  expect(screen.getByRole('alert').textContent).toBe(text.auth.passwordMismatch);
  fireEvent.change(confirmation, { target: { value: '😀😀' } });
  fireEvent.submit(form);
  fireEvent.submit(form);
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe(text.auth.resetSuccess));
  expect(api.resetPassword).toHaveBeenCalledExactlyOnceWith({
    token: 'private',
    new_password: '😀😀',
  });
});

it('expired reset offers a new link rather than resubmitting the consumed token', async () => {
  vi.mocked(api.resetPassword).mockRejectedValue(invalidLink);
  show(<ResetPasswordPage />, '/reset-password?token=expired');
  fireEvent.change(screen.getByLabelText(text.auth.newPassword), {
    target: { value: 'password123' },
  });
  fireEvent.change(screen.getByLabelText(text.auth.confirmNewPassword), {
    target: { value: 'password123' },
  });
  fireEvent.submit(screen.getByLabelText(text.auth.newPassword).closest('form')!);
  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toBe(text.auth.invalidResetLink),
  );
  expect(screen.queryByRole('button', { name: text.auth.resetPassword })).toBeNull();
});

it('a replacement link on the same route captures the new token and resets terminal state', async () => {
  vi.mocked(api.verifyEmail)
    .mockRejectedValueOnce(invalidLink)
    .mockResolvedValueOnce({ status: 'verified' });
  show(<VerifyEmailPage />, '/verify-email#token=expired');
  fireEvent.click(screen.getByRole('button', { name: text.auth.verifyConfirm }));
  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toBe(text.auth.invalidVerificationLink),
  );
  fireEvent.click(screen.getByRole('link', { name: 'replacement link' }));
  expect(screen.getByLabelText('location').textContent).toBe('/verify-email');
  fireEvent.click(screen.getByRole('button', { name: text.auth.verifyConfirm }));
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe(text.auth.verifySuccess));
  expect(api.verifyEmail).toHaveBeenLastCalledWith({ token: 'replacement' });
});

it('reset prevents a delayed initial hydration from reopening a revoked session', async () => {
  useSessionStore.setState({ status: 'loading', account: null });
  let resolve!: (value: Awaited<ReturnType<typeof api.getSession>>) => void;
  vi.mocked(api.getSession).mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  const hydration = useSessionStore.getState().hydrate();
  vi.mocked(api.getSession).mockRejectedValueOnce(
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
  vi.mocked(api.resetPassword).mockResolvedValue({ status: 'reset' });
  show(<ResetPasswordPage />, '/reset-password#token=private');
  fireEvent.change(screen.getByLabelText(text.auth.newPassword), {
    target: { value: 'password123' },
  });
  fireEvent.change(screen.getByLabelText(text.auth.confirmNewPassword), {
    target: { value: 'password123' },
  });
  fireEvent.submit(screen.getByLabelText(text.auth.newPassword).closest('form')!);
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe(text.auth.resetSuccess));
  resolve({
    account: {
      id: 'revoked-account',
      email: 'a@example.test',
      name: null,
      timezone: 'UTC+07:00',
      email_verified: true,
    },
  });
  await hydration;
  expect(useSessionStore.getState().status).toBe('anonymous');
  expect(useSessionStore.getState().account).toBeNull();
});

it('network failures do not pretend a forgot request was accepted; retry remains available', async () => {
  vi.mocked(api.forgotPassword)
    .mockRejectedValueOnce(new TypeError('offline'))
    .mockResolvedValueOnce(undefined);
  show(<ForgotPasswordPage />, '/forgot-password');
  fireEvent.change(screen.getByLabelText(text.common.email), {
    target: { value: 'unknown@example.test' },
  });
  const form = screen.getByLabelText(text.common.email).closest('form')!;
  fireEvent.submit(form);
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(text.common.unknownError));
  expect(screen.getByLabelText('location').textContent).toBe('/forgot-password');
  fireEvent.submit(form);
  fireEvent.submit(form);
  await waitFor(() =>
    expect(screen.getByLabelText('location').textContent).toBe('/forgot-password/sent'),
  );
  expect(api.forgotPassword).toHaveBeenCalledTimes(2);
});

it('verification network errors are retryable without discarding the token', async () => {
  vi.mocked(api.verifyEmail)
    .mockRejectedValueOnce(new TypeError('offline'))
    .mockResolvedValueOnce({ status: 'verified' });
  show(<VerifyEmailPage />, '/verify-email#token=private');
  fireEvent.click(screen.getByRole('button', { name: text.auth.verifyConfirm }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(text.common.unknownError));
  fireEvent.click(screen.getByRole('button', { name: text.auth.verifyConfirm }));
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe(text.auth.verifySuccess));
});

it('resend network errors report failure instead of acceptance and allow retry', async () => {
  vi.mocked(api.resendVerificationEmail)
    .mockRejectedValueOnce(new TypeError('offline'))
    .mockResolvedValueOnce(undefined);
  show(<VerifyEmailPage />, '/verify-email');
  fireEvent.change(screen.getByLabelText(text.common.email), {
    target: { value: 'a@example.test' },
  });
  const form = screen.getByLabelText(text.common.email).closest('form')!;
  fireEvent.submit(form);
  await waitFor(() => expect(screen.getByText(text.common.unknownError)).toBeTruthy());
  expect(screen.queryByRole('status')).toBeNull();
  fireEvent.submit(form);
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe(text.auth.resent));
});

it('reset network errors permit retry with the same token', async () => {
  vi.mocked(api.resetPassword)
    .mockRejectedValueOnce(new TypeError('offline'))
    .mockResolvedValueOnce({ status: 'reset' });
  show(<ResetPasswordPage />, '/reset-password#token=private');
  fireEvent.change(screen.getByLabelText(text.auth.newPassword), {
    target: { value: 'password123' },
  });
  fireEvent.change(screen.getByLabelText(text.auth.confirmNewPassword), {
    target: { value: 'password123' },
  });
  const form = screen.getByLabelText(text.auth.newPassword).closest('form')!;
  fireEvent.submit(form);
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(text.common.unknownError));
  fireEvent.submit(form);
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe(text.auth.resetSuccess));
  expect(api.resetPassword).toHaveBeenCalledTimes(2);
});
