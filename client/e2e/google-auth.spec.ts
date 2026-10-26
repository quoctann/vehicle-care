import { expect, test, type Page } from '@playwright/test';
import { vi } from '../src/i18n/locales/vi';

const text = vi.translation;
const account = {
  id: 'c50fa56c-b7a0-43d0-9741-f81565bd2c1d',
  email: 'driver@example.test',
  name: 'Driver',
  timezone: 'UTC+07:00',
  email_verified: true,
};
const status = { enabled: true, linked: false, has_password: true };

async function mockApi(page: Page, authenticated = true, googleStatus = status) {
  await page
    .context()
    .addCookies([{ name: 'csrf_token', value: 'google-csrf', url: 'http://localhost:4179' }]);
  await page.route('http://localhost:4179/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/session')
      return route.fulfill(
        authenticated
          ? { json: { account } }
          : {
              status: 401,
              json: { error: { code: 'session_expired', message: 'Expired', retryable: false } },
            },
      );
    if (path === '/api/auth/google/status') return route.fulfill({ json: googleStatus });
    if (path === '/api/auth/logout') return route.fulfill({ status: 204 });
    if (path === '/api/devices/register')
      return route.fulfill({
        json: {
          account_id: account.id,
          device_id: route.request().postDataJSON().device_id,
          registered_at: '2026-10-26T00:00:00Z',
        },
      });
    if (path === '/api/sync/pull')
      return route.fulfill({
        json: {
          account_id: account.id,
          changes: [],
          next_cursor: 0,
          until_seq: 0,
          has_more: false,
          server_time: '2026-10-26T00:00:00Z',
        },
      });
    return route.abort();
  });
}

for (const [path, label] of [
  ['/sign-in', text.auth.continueGoogle],
  ['/sign-up', text.auth.signUpGoogle],
]) {
  test(`Google login/signup uses document redirect from ${path}`, async ({ page }) => {
    await mockApi(page, false);
    await page.route('**/api/auth/google/start', (route) => {
      expect(route.request().isNavigationRequest()).toBe(true);
      expect(route.request().method()).toBe('GET');
      return route.fulfill({
        contentType: 'text/html',
        body: '<h1>Backend Google redirect entry</h1>',
      });
    });
    await page.goto(path);
    await page.getByRole('button', { name: label }).click();
    await expect(page).toHaveURL('/api/auth/google/start');
    await expect(
      page.getByRole('heading', { name: 'Backend Google redirect entry' }),
    ).toBeVisible();
  });
}

test('callback errors are translated, allowlisted and stripped without losing unrelated route query', async ({
  page,
}) => {
  await mockApi(page, false);
  await page.goto('/sign-in?google_error=email_exists&code=secret&state=secret&next=keep');
  await expect(page.getByRole('alert')).toHaveText(text.google.errors.email_exists);
  await expect(page).toHaveURL('/sign-in?next=keep');
  await page.goto('/sign-in?google_error=%3Cscript%3E&error_description=secret');
  await expect(page.getByRole('alert')).toHaveText(text.google.errors.failed);
  await expect(page).toHaveURL('/sign-in');
});

test('link requires password and CSRF, then navigates to Google without changing local workspace', async ({
  page,
}) => {
  await mockApi(page);
  let body: unknown;
  await page.route('**/api/auth/google/link', (route) => {
    body = route.request().postDataJSON();
    expect(route.request().headers()['x-csrf-token']).toBe('google-csrf');
    return route.fulfill({
      json: { authorization_url: 'https://accounts.google.com/o/oauth2/v2/auth?state=link' },
    });
  });
  await page.route('https://accounts.google.com/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<h1>Google authorization</h1>' }),
  );
  await page.goto('/settings');
  await page.getByRole('button', { name: text.google.link }).click();
  await expect(page.getByLabel(text.google.password)).toBeVisible();
  await page.getByLabel(text.google.password).fill('reauth-password');
  await page.getByRole('button', { name: text.google.confirm }).click();
  await expect(page).toHaveURL(/^https:\/\/accounts.google.com\//);
  expect(body).toEqual({ password: 'reauth-password', expected_account_id: account.id });
});

test('settings success/error callbacks clean history and display feedback', async ({ page }) => {
  await mockApi(page, true, { ...status, linked: true, has_password: false });
  await page.goto('/settings?google=linked&state=secret');
  await expect(page.getByRole('status').filter({ hasText: text.google.success })).toBeVisible();
  await expect(page).toHaveURL('/settings');
  await expect(page.getByText(text.google.linked, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: text.google.link, exact: true })).toHaveCount(0);
  await page.goto('/settings?google_error=identity_linked');
  await expect(page.getByRole('alert')).toHaveText(text.google.errors.identity_linked);
  await expect(page).toHaveURL('/settings');
});

test('disabled provider and offline state never offer linking', async ({ page, context }) => {
  await mockApi(page, true, { ...status, enabled: false });
  await page.goto('/settings');
  await expect(page.getByText(text.google.errors.unavailable)).toBeVisible();
  await expect(page.getByRole('button', { name: text.google.link, exact: true })).toHaveCount(0);
  await context.setOffline(true);
  await expect(page.getByText(text.google.offline)).toBeVisible();
});

test('late link response after a session change cannot restore UI or redirect', async ({
  page,
}) => {
  await mockApi(page);
  let resolve!: () => void;
  const wait = new Promise<void>((r) => {
    resolve = r;
  });
  // Network completion alone is not application completion. Signal after the
  // fetch wrapper consumes JSON and the resulting promise continuations drain.
  await page.addInitScript(() => {
    let consumed!: () => void;
    Object.assign(window, {
      googleLinkConsumed: new Promise<void>((resolveConsumed) => {
        consumed = resolveConsumed;
      }),
    });
    const fetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const response = await fetch(...args);
      if (new URL(response.url).pathname === '/api/auth/google/link') {
        const json = response.json.bind(response);
        response.json = async () => {
          try {
            return await json();
          } finally {
            const checkpoint = new MessageChannel();
            checkpoint.port1.onmessage = () => {
              consumed();
              checkpoint.port1.close();
              checkpoint.port2.close();
            };
            checkpoint.port2.postMessage(null);
          }
        };
      }
      return response;
    };
  });
  await page.route('**/api/auth/google/link', async (route) => {
    await wait;
    await route.fulfill({
      json: { authorization_url: 'https://accounts.google.com/o/oauth2/v2/auth?state=stale' },
    });
  });
  await page.goto('/settings');
  await page.getByRole('button', { name: text.google.link, exact: true }).click();
  await page.getByLabel(text.google.password).fill('reauth-password');
  const sent = page.waitForRequest('**/api/auth/google/link');
  await page.getByRole('button', { name: text.google.confirm }).click();
  await sent;
  await page.evaluate(async () => {
    const { useSessionStore } = await import('/src/stores/useSessionStore.ts');
    const current = useSessionStore.getState().account!;
    useSessionStore.getState().setAuthenticated({ ...current, id: 'another-account' });
  });
  const received = page.waitForResponse('**/api/auth/google/link');
  resolve();
  expect(await (await received).finished()).toBeNull();
  await page.evaluate(
    () => (window as unknown as { googleLinkConsumed: Promise<void> }).googleLinkConsumed,
  );
  await expect(page).toHaveURL('/settings');
  await expect(page.getByLabel(text.google.password)).toHaveCount(0);
});

test('late status response from the previous account is ignored', async ({ page }) => {
  await mockApi(page);
  let resolve!: () => void;
  const wait = new Promise<void>((r) => {
    resolve = r;
  });
  let finished!: () => void;
  const settled = new Promise<void>((r) => {
    finished = r;
  });
  await page.route('**/api/auth/google/status?**', async (route) => {
    if (new URL(route.request().url()).searchParams.get('expected_account_id') !== account.id)
      return route.fulfill({ json: { ...status, enabled: false } });
    await wait;
    await route.fulfill({ json: { ...status, linked: true } });
    finished();
  });
  const sent = page.waitForRequest('**/api/auth/google/status?**');
  await page.goto('/settings');
  await sent;
  await page.evaluate(async () => {
    const { useSessionStore } = await import('/src/stores/useSessionStore.ts');
    const current = useSessionStore.getState().account!;
    useSessionStore
      .getState()
      .setAuthenticated({ ...current, id: '13038800-180d-4bf0-97b7-1b30086c07a2' });
  });
  await expect(page.getByText(text.google.errors.unavailable)).toBeVisible();
  resolve();
  await settled;
  await expect(page.getByText(text.google.linked, { exact: true })).toHaveCount(0);
  await expect(page.getByText(text.google.errors.unavailable)).toBeVisible();
});
