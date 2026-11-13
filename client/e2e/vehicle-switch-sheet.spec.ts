import { expect, test, type BrowserContext, type Page } from '@playwright/test';

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
 * Regression for the vehicle switcher sheet: below lg it must stay the familiar
 * bottom sheet (full width on phones, ≤600px centered on tablets); at lg+ it
 * must appear as a screen-centered dialog like the add-reminder dialog.
 * The bug: `data-[side=bottom]:inset-x-0` (specificity 0,2,0) used to beat the
 * plain `lg:left-1/2` overrides (0,1,0) while `-translate-x-1/2` still applied,
 * leaving the sheet exactly half its width too far left on desktop.
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

/** Opens the vehicle switcher from whichever header is visible, then waits for
 *  the sheet's open animation (duration-200) to settle before measuring. */
async function openSheet(page: Page): Promise<{ box: DOMRect }> {
  page.on('pageerror', (error) => {
    throw error;
  });
  await page.goto('/');
  await page.waitForURL(new RegExp(`/v/${vehicleId}/home$`), { timeout: 10000 });

  await page.getByRole('button', { name: 'Chuyển xe' }).click();
  const sheet = page.locator('[data-slot="sheet-content"]');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText('Thêm một chiếc xe')).toBeVisible();
  await page.waitForTimeout(500);
  const box = (await sheet.boundingBox())!;
  return { box };
}

test.describe('desktop (lg)', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('vehicle switcher opens as a dialog centered on screen', async ({ page, context }) => {
    await mockAccountBackend(context);
    const { box } = await openSheet(page);

    // Centered on both axes like the add-reminder dialog (tolerance 2px).
    expect(Math.abs(box.x + box.width / 2 - 640)).toBeLessThanOrEqual(2);
    expect(Math.abs(box.y + box.height / 2 - 400)).toBeLessThanOrEqual(2);
    expect(box.width).toBeCloseTo(440, 0);
  });
});

test.describe('tablet (md…lg)', () => {
  test.use({ viewport: { width: 820, height: 1180 } });

  test('vehicle switcher stays a bottom sheet capped at 600px, centered', async ({
    page,
    context,
  }) => {
    await mockAccountBackend(context);
    const { box } = await openSheet(page);

    // Still bottom-anchored: the sheet's bottom edge touches the viewport.
    expect(Math.abs(box.y + box.height - 1180)).toBeLessThanOrEqual(2);
    // Capped at 600px and horizontally centered.
    expect(box.width).toBeCloseTo(600, 0);
    expect(Math.abs(box.x + box.width / 2 - 410)).toBeLessThanOrEqual(2);
  });
});

test.describe('mobile (<md)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('vehicle switcher stays a full-width bottom sheet', async ({ page, context }) => {
    await mockAccountBackend(context);
    const { box } = await openSheet(page);

    expect(Math.abs(box.x)).toBeLessThanOrEqual(2);
    expect(box.width).toBeCloseTo(390, 0);
    expect(Math.abs(box.y + box.height - 844)).toBeLessThanOrEqual(2);
  });
});
