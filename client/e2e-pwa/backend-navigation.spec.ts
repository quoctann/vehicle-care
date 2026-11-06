import { expect, test, type Page } from '@playwright/test';

/**
 * Regression for the production Google OAuth failure: the service worker's
 * navigateFallback app shell must never answer full-page navigations to
 * backend-proxied paths. The OAuth start and callback are document
 * navigations whose backend 302 chain has to reach the browser; before the
 * navigateFallbackDenylist, the worker answered them with cached index.html,
 * the SPA router bounced users to /sign-in, and the authorization request
 * never left the browser. The fixture in e2e-pwa/server.mjs mirrors the
 * production nginx proxy topology and answers these paths with 401 JSON.
 */
async function workerState(page: Page) {
  return page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return {
      active: registration?.active?.state,
      controlled: !!navigator.serviceWorker.controller,
    };
  });
}

const BACKEND_NAVIGATIONS = [
  '/auth/google/start',
  '/auth/google/callback?code=secret-code&state=login.secret-state',
  '/part-types',
  '/part-types?limit=100',
];

test('controlling service worker passes backend navigations through to the network', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect.poll(() => workerState(page)).toMatchObject({ active: 'activated' });
  // A returning user's tab is controlled by the worker before any navigation.
  await page.reload();
  await expect.poll(() => workerState(page)).toMatchObject({ controlled: true });

  for (const path of BACKEND_NAVIGATIONS) {
    const response = await page.goto(path);
    // 401 JSON comes from the fixture: the worker must not answer from its
    // cached app shell (200 HTML, then the SPA router redirecting away).
    expect(response?.status(), path).toBe(401);
    expect(response?.headers()['content-type'], path).toContain('application/json');
    expect(await response?.text(), path).toContain('pwa-fixture');
    expect(await page.evaluate(() => location.pathname + location.search), path).toBe(path);
  }

  // Passing through does not unregister or break the controlling worker.
  await expect
    .poll(() => workerState(page))
    .toMatchObject({ active: 'activated', controlled: true });
  expect(errors).toEqual([]);
});
