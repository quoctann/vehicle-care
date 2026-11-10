import { expect, test } from '@playwright/test';

const account = {
  id: 'c50fa56c-b7a0-43d0-9741-f81565bd2c1d',
  email: 'driver@example.test',
  name: 'Regression Driver',
  timezone: 'UTC+07:00',
  email_verified: true,
};

const vehicleId = '13038800-180d-4bf0-97b7-1b30086c07a2';
const partTypeId = '13038800-180d-4bf0-97b7-1b30086c07a3';
const serverTime = '2026-10-25T08:00:00Z';

/**
 * Regression for Android Chrome overscroll on the Add/Edit Record form.
 * The form must own vertical gestures; at scroll boundaries the gesture must
 * not chain to the document or displace the bottom tab bar.
 */
test.use({
  // A short mobile viewport guarantees the form content is taller than its
  // scroll container so we can actually reach a scroll boundary.
  viewport: { width: 390, height: 500 },
  hasTouch: true,
});

test('Log Entry form absorbs vertical overscroll and keeps the tab bar fixed', async ({
  page,
  context,
}) => {
  page.on('pageerror', (error) => {
    throw error;
  });

  let pullSeeded = false;

  await context.route(
    (url) => {
      const path = url.pathname;
      return (
        path.startsWith('/api/') ||
        path === '/auth/session' ||
        path === '/devices/register' ||
        path === '/sync/pull'
      );
    },
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname;
      if (path === '/api/auth/session' || path === '/auth/session') {
        return route.fulfill({ json: { account } });
      }
      if (path === '/api/devices/register' || path === '/devices/register') {
        return route.fulfill({
          json: {
            account_id: account.id,
            device_id: request.postDataJSON().device_id,
            registered_at: serverTime,
          },
        });
      }
      if (path === '/api/sync/pull' || path === '/sync/pull') {
        const afterSeq = Number(url.searchParams.get('after_seq')) || 0;
        if (!pullSeeded && afterSeq === 0) {
          pullSeeded = true;
          return route.fulfill({
            json: {
              account_id: account.id,
              changes: [
                {
                  entity_type: 'vehicle',
                  entity_id: vehicleId,
                  operation: 'create',
                  server_seq: 1,
                  server_synced_at: serverTime,
                  payload: {
                    name: 'Overscroll bike',
                    plate_number: null,
                    archived_at: null,
                    deleted_at: null,
                    due_soon_ratio: null,
                  },
                },
                {
                  entity_type: 'part_type',
                  entity_id: partTypeId,
                  operation: 'create',
                  server_seq: 2,
                  server_synced_at: serverTime,
                  payload: {
                    code: partTypeId,
                    name: 'Dầu máy',
                    display_order: 1,
                    active: true,
                  },
                },
              ],
              next_cursor: 2,
              until_seq: 2,
              has_more: false,
              server_time: serverTime,
            },
          });
        }
        return route.fulfill({
          json: {
            account_id: account.id,
            changes: [],
            next_cursor: afterSeq,
            until_seq: afterSeq,
            has_more: false,
            server_time: serverTime,
          },
        });
      }
      return route.continue();
    },
  );

  // Let the app bootstrap and pull the seeded vehicle, then open the form.
  await page.goto('/');
  await page.waitForURL(new RegExp(`/v/${vehicleId}/home$`), { timeout: 10000 });
  await page.goto(`/v/${vehicleId}/log-entry`);

  const heading = page.getByRole('heading', { name: 'Mục ghi mới' });
  await expect(heading).toBeVisible();

  const form = page.locator('form').filter({ has: heading });
  const saveButton = page.getByRole('button', { name: 'Lưu mục ghi' });
  const tabBar = page.getByRole('navigation', { name: 'Điều hướng chính' });

  await expect(form).toBeVisible();
  await expect(saveButton).toBeVisible();
  await expect(tabBar).toBeVisible();

  // The scrollable form must declare that it owns vertical overscroll.
  const overscroll = await form.evaluate((el) => getComputedStyle(el).overscrollBehaviorY);
  expect(overscroll).toBe('none');

  // Ensure the form is actually scrollable; otherwise the boundary test is vacuous.
  const scrollable = await form.evaluate((el) => el.scrollHeight > el.clientHeight);
  expect(scrollable).toBe(true);

  // Scroll to the bottom boundary inside the form.
  await form.evaluate((el) => {
    el.scrollTo({ top: el.scrollHeight, behavior: 'instant' });
  });

  const initialTabBox = await tabBar.boundingBox();
  expect(initialTabBox).not.toBeNull();

  // Attempt to overscroll downward from the form's bottom boundary. With
  // overscroll-behavior-y: none the document must not scroll and the tab bar
  // must keep the same on-screen position.
  const formBox = await form.boundingBox();
  expect(formBox).not.toBeNull();
  await page.mouse.move(formBox!.x + formBox!.width / 2, formBox!.y + formBox!.height / 2);
  await page.mouse.wheel(0, 500);

  const documentScrollY = await page.evaluate(() => window.scrollY);
  expect(documentScrollY).toBe(0);

  const finalTabBox = await tabBar.boundingBox();
  expect(finalTabBox).not.toBeNull();
  expect(finalTabBox!.y).toBe(initialTabBox!.y);
  expect(finalTabBox!.height).toBe(initialTabBox!.height);

  // The sticky save action must still sit above the tab bar.
  await expect(saveButton).toBeInViewport();
});
