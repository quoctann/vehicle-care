import { expect, test, type Page } from '@playwright/test';
import { vi } from '../src/i18n/locales/vi';

const text = vi.translation;
async function anonymous(page: Page) {
  await page.route('**/api/auth/session', (route) =>
    route.fulfill({
      status: 401,
      json: { error: { code: 'session_expired', message: 'Expired', retryable: false } },
    }),
  );
}

test('verification is public, strips tokens, requires confirmation and handles replay with resend', async ({
  page,
}) => {
  await anonymous(page);
  let calls = 0;
  await page.route('**/api/auth/verify-email', (route) => {
    calls += 1;
    expect(route.request().postDataJSON()).toEqual({ token: 'private-token' });
    expect(route.request().headers().referer).not.toContain('private-token');
    return route.fulfill({
      status: 400,
      json: { error: { code: 'validation_failed', message: 'Expired', retryable: false } },
    });
  });
  await page.route('**/api/auth/verify-email/resend', (route) => route.fulfill({ json: {} }));
  await page.goto('/verify-email?next=keep#token=private-token');
  await expect(page).toHaveURL('/verify-email?next=keep');
  await expect(page.getByRole('button', { name: text.auth.verifyConfirm })).toBeVisible();
  expect(calls).toBe(0);
  await page.getByRole('button', { name: text.auth.verifyConfirm }).click();
  await expect(page.getByRole('alert')).toHaveText(text.auth.invalidVerificationLink);
  await page.getByLabel(text.common.email).fill('unknown@example.test');
  await page.getByRole('button', { name: text.auth.resendEmail }).click();
  await expect(page.getByRole('status')).toHaveText(text.auth.resent);
  expect(calls).toBe(1);
});

test('verification success cannot repeat submit; missing link offers recovery', async ({
  page,
}) => {
  await anonymous(page);
  let calls = 0;
  await page.route('**/api/auth/verify-email', async (route) => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 150));
    await route.fulfill({ json: { status: 'verified' } });
  });
  await page.goto('/verify-email?token=legacy');
  await expect(page).toHaveURL('/verify-email');
  await page.getByRole('button', { name: text.auth.verifyConfirm }).dblclick();
  await expect(page.getByRole('status')).toHaveText(text.auth.verifySuccess);
  expect(calls).toBe(1);
  await page.reload();
  await expect(page.getByRole('alert')).toHaveText(text.auth.invalidVerificationLink);
  await expect(page.getByLabel(text.common.email)).toBeVisible();
});

test('reset strips fragment, enforces UTF8 bytes and confirmation, submits only once', async ({
  page,
}) => {
  await anonymous(page);
  let calls = 0;
  await page.route('**/api/auth/password/reset', async (route) => {
    calls += 1;
    expect(route.request().postDataJSON()).toEqual({
      token: 'reset-private',
      new_password: '😀😀',
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    await route.fulfill({ json: { status: 'reset' } });
  });
  await page.goto('/reset-password#token=reset-private');
  await expect(page).toHaveURL('/reset-password');
  await page.getByLabel(text.auth.newPassword, { exact: true }).fill('😀'.repeat(19));
  await page.getByLabel(text.auth.confirmNewPassword).fill('😀'.repeat(19));
  await page.getByRole('button', { name: text.auth.resetPassword, exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText(text.auth.passwordBytes);
  await page.getByLabel(text.auth.newPassword, { exact: true }).fill('😀😀');
  await page.getByRole('button', { name: text.auth.resetPassword, exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText(text.auth.passwordMismatch);
  await page.getByLabel(text.auth.confirmNewPassword).fill('😀😀');
  await page.getByRole('button', { name: text.auth.resetPassword, exact: true }).dblclick();
  await expect(page.getByRole('status')).toHaveText(text.auth.resetSuccess);
  expect(calls).toBe(1);
});

test('forgot network errors do not claim acceptance and can be retried', async ({ page }) => {
  await anonymous(page);
  await page.route('**/api/auth/password/forgot', (route) => route.abort());
  await page.goto('/forgot-password');
  await page.getByLabel(text.common.email).fill('unknown@example.test');
  await page.getByRole('button', { name: text.auth.sendResetLink }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page).toHaveURL('/forgot-password');
  await page.route('**/api/auth/password/forgot', (route) => route.fulfill({ json: {} }));
  await page.getByRole('button', { name: text.auth.sendResetLink }).click();
  await expect(page).toHaveURL('/forgot-password/sent');
});
