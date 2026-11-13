import { expect, test, type BrowserContext } from '@playwright/test';

const account = {
  id: 'c50fa56c-b7a0-43d0-9741-f81565bd2c1d',
  email: 'driver@example.test',
  name: 'Regression Driver',
  timezone: 'UTC+07:00',
  email_verified: true,
};

const vehicleId = '13038800-180d-4bf0-97b7-1b30086c07a2';
const serverTime = '2026-10-25T08:00:00Z';

/**
 * Regression for the home-page header row: the "Trang chủ" heading must stay
 * left while the sync status button + sync-recovery button behave as ONE
 * right-aligned group (like the mobile/tablet header). SyncStatusBadge renders
 * two sibling buttons, so any parent spreading flex children (e.g.
 * justify-between on the desktop header) used to tear the pair apart.
 */

/** Seeds session/device/pull so one vehicle exists locally before home opens. */
async function mockAccountBackend(context: BrowserContext) {
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
      const path = new URL(request.url()).pathname.replace(/^\/api/, '');
      if (path === '/auth/session') {
        return route.fulfill({ json: { account } });
      }
      if (path === '/devices/register') {
        return route.fulfill({
          json: {
            account_id: account.id,
            device_id: request.postDataJSON().device_id,
            registered_at: serverTime,
          },
        });
      }
      if (path === '/sync/pull') {
        const url = new URL(request.url());
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
                    name: 'Header bike',
                    plate_number: null,
                    archived_at: null,
                    deleted_at: null,
                    due_soon_ratio: null,
                  },
                },
              ],
              next_cursor: 1,
              until_seq: 1,
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
}

/** The sync status button (aria-live) and the recovery button, as a pair.
 *  Both headers exist in the DOM (mobile `lg:hidden` + desktop `hidden lg:flex`),
 *  so intersect with getByRole to keep only the visible one. */
function syncControls(page: import('@playwright/test').Page) {
  return {
    status: page.getByRole('button').and(page.locator('button[aria-live="polite"]')),
    recovery: page.getByRole('button', { name: 'Xử lý dữ liệu chưa đồng bộ' }),
  };
}

test.describe('desktop home header (lg)', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('keeps "Trang chủ" left and the sync buttons grouped right', async ({ page, context }) => {
    page.on('pageerror', (error) => {
      throw error;
    });
    await mockAccountBackend(context);

    await page.goto('/');
    await page.waitForURL(new RegExp(`/v/${vehicleId}/home$`), { timeout: 10000 });

    const heading = page.getByRole('heading', { name: 'Trang chủ' });
    await expect(heading).toBeVisible();
    const { status, recovery } = syncControls(page);
    await expect(status).toBeVisible();
    await expect(recovery).toBeVisible();
    // Wait until bootstrap sync settles so the status label stops resizing.
    await expect(status).toContainText('Đã đồng bộ');

    const headingBox = (await heading.boundingBox())!;
    const statusBox = (await status.boundingBox())!;
    const recoveryBox = (await recovery.boundingBox())!;
    const rowBox = (await heading.locator('xpath=..').boundingBox())!;

    // The heading stays at the left of the row.
    expect(headingBox.x).toBeLessThan(rowBox.x + 20);

    // The two buttons form one tightly grouped cluster (gap-2.5 ≈ 10px),
    // vertically centered together — not spread apart by justify-between.
    const gap = recoveryBox.x - (statusBox.x + statusBox.width);
    expect(gap).toBeGreaterThanOrEqual(8.5);
    expect(gap).toBeLessThanOrEqual(11.5);
    expect(
      Math.abs(statusBox.y + statusBox.height / 2 - (recoveryBox.y + recoveryBox.height / 2)),
    ).toBeLessThanOrEqual(1);

    // The whole cluster hugs the row's right edge (px-4 = 16px padding).
    expect(
      Math.abs(recoveryBox.x + recoveryBox.width - (rowBox.x + rowBox.width - 16)),
    ).toBeLessThanOrEqual(2);
    expect(statusBox.x).toBeGreaterThan(headingBox.x + headingBox.width);
  });
});

test.describe('mobile home header (<lg)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('keeps the vehicle switcher left and the sync buttons grouped right', async ({
    page,
    context,
  }) => {
    page.on('pageerror', (error) => {
      throw error;
    });
    await mockAccountBackend(context);

    await page.goto('/');
    await page.waitForURL(new RegExp(`/v/${vehicleId}/home$`), { timeout: 10000 });

    const { status, recovery } = syncControls(page);
    await expect(status).toBeVisible();
    await expect(recovery).toContainText('');
    await expect(status).toContainText('Đã đồng bộ');

    const statusBox = (await status.boundingBox())!;
    const recoveryBox = (await recovery.boundingBox())!;
    const headerBox = (await page.locator('header').boundingBox())!;

    // Same grouping as before the fix: ~10px between the two buttons.
    const gap = recoveryBox.x - (statusBox.x + statusBox.width);
    expect(gap).toBeGreaterThanOrEqual(8.5);
    expect(gap).toBeLessThanOrEqual(11.5);

    // The cluster hugs the header's right edge (px-4 = 16px padding).
    expect(
      Math.abs(recoveryBox.x + recoveryBox.width - (headerBox.x + headerBox.width - 16)),
    ).toBeLessThanOrEqual(2);
  });
});
