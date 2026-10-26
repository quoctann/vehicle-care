import { expect, test, type Page } from '@playwright/test';
import { vi } from '../src/i18n/locales/vi';

const account = {
  id: 'c50fa56c-b7a0-43d0-9741-f81565bd2c1d',
  email: 'driver@example.test',
  name: 'Driver',
  timezone: 'UTC',
  email_verified: true,
};
const vehicleId = '13038800-180d-4bf0-97b7-1b30086c07a2';
const partId = '13038800-180d-4bf0-97b7-1b30086c07a3';
const reminderId = '13038800-180d-4bf0-97b7-1b30086c07a4';
const serverTime = '2026-10-25T08:00:00Z';

async function workspace(page: Page) {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('vehicle-maintenance');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const database = open.result;
          const tables = ['reminderConfigs', 'outbox', 'syncMeta'];
          const transaction = database.transaction(tables, 'readonly');
          const result: Record<string, unknown> = {};
          for (const table of tables) {
            const request = transaction.objectStore(table).getAll();
            request.onsuccess = () => {
              result[table] = request.result;
            };
          }
          transaction.oncomplete = () => {
            database.close();
            resolve(result);
          };
          transaction.onabort = () => {
            database.close();
            reject(transaction.error);
          };
        };
      }),
  );
}

for (const editing of [false, true]) {
  for (const field of editing ? ['km', 'days'] : ['km', 'days', 'baseline-km']) {
    test(`${editing ? 'edit' : 'create'} rejects incomplete exponent in ${field} without persisting`, async ({
      page,
      context,
    }) => {
      page.on('pageerror', (error) => {
        throw error;
      });
      const changes = [
        {
          entity_type: 'vehicle',
          entity_id: vehicleId,
          payload: {
            name: 'Validation bike',
            plate_number: null,
            archived_at: null,
            deleted_at: null,
            due_soon_ratio: null,
          },
        },
        {
          entity_type: 'part_type',
          entity_id: partId,
          payload: { code: partId, name: 'Validation oil', display_order: 1, active: true },
        },
        ...(editing
          ? [
              {
                entity_type: 'reminder_config',
                entity_id: reminderId,
                payload: {
                  vehicle_id: vehicleId,
                  part_type_id: partId,
                  interval_km: 100,
                  interval_days: 10,
                  baseline_odometer_km: 0,
                  baseline_date: '2026-10-25',
                  enabled: true,
                  deleted_at: null,
                },
              },
            ]
          : []),
      ].map((change, index) => ({
        ...change,
        operation: 'create',
        server_seq: index + 1,
        server_synced_at: serverTime,
      }));

      await context.route('http://localhost:4179/api/**', (route) => {
        const url = new URL(route.request().url());
        if (url.pathname === '/api/auth/session') return route.fulfill({ json: { account } });
        if (url.pathname === '/api/devices/register')
          return route.fulfill({
            json: {
              account_id: account.id,
              device_id: route.request().postDataJSON().device_id,
              registered_at: serverTime,
            },
          });
        if (url.pathname === '/api/sync/pull')
          return route.fulfill({
            json: {
              account_id: account.id,
              changes: Number(url.searchParams.get('after_seq')) === 0 ? changes : [],
              next_cursor: changes.length,
              until_seq: changes.length,
              has_more: false,
              server_time: serverTime,
            },
          });
        return route.abort();
      });
      await page.goto(`/v/${vehicleId}/reminders`);
      // Wait for the application to open/initialize IndexedDB before inspecting it.
      await expect(page.getByRole('button', { name: /Đã đồng bộ/ })).toBeVisible();
      await expect
        .poll(async () => {
          const state = (await workspace(page)) as { syncMeta: { lastSeenSeq: number }[] };
          return state.syncMeta[0]?.lastSeenSeq;
        })
        .toBe(changes.length);
      await page.goto(`/v/${vehicleId}/reminders`);
      await expect(page.getByText('Validation bike', { exact: true }).first()).toBeVisible();
      await context.setOffline(true);
      if (editing)
        await page.getByRole('button', { name: 'Sửa nhắc Validation oil', exact: true }).click();
      else {
        await page.getByRole('button', { name: 'Thêm nhắc nhở', exact: true }).first().click();
        await page.locator('#new-reminder-km').fill('100');
        await page.locator('#new-reminder-days').fill('10');
        await page.locator('#new-reminder-baseline-km').fill('0');
      }
      const input = page.locator(`#${editing ? '' : 'new-'}reminder-${field}`);
      await input.fill('');
      await input.pressSequentially('1e');
      await expect(input).toHaveValue('');
      expect(await input.evaluate((node: HTMLInputElement) => node.validity.badInput)).toBe(true);
      const before = await workspace(page);
      await page
        .getByRole('button', { name: editing ? 'Lưu thay đổi' : 'Thêm nhắc nhở', exact: true })
        .last()
        .click();
      await expect(page.getByRole('alert')).toHaveText(
        field === 'km'
          ? vi.translation.reminder.intervalKmRange
          : field === 'days'
            ? vi.translation.reminder.intervalDaysRange
            : vi.translation.logEntry.odometerRange,
      );
      expect(await workspace(page)).toEqual(before);
      await expect(page.getByRole('dialog')).toBeVisible();
      await input.fill('5');
      expect(await input.evaluate((node: HTMLInputElement) => node.validity.badInput)).toBe(false);
      await page
        .getByRole('button', { name: editing ? 'Lưu thay đổi' : 'Thêm nhắc nhở', exact: true })
        .last()
        .click();
      await expect(page.getByRole('dialog')).not.toBeVisible();
      const saved = await workspace(page);
      expect(saved).toMatchObject({
        reminderConfigs: [
          expect.objectContaining({
            intervalKm: field === 'km' ? 5 : 100,
            intervalDays: field === 'days' ? 5 : 10,
            baselineOdometerKm: field === 'baseline-km' ? 5 : 0,
          }),
        ],
        outbox: [
          expect.objectContaining({
            entityType: 'reminder_config',
            operation: editing ? 'update' : 'create',
          }),
        ],
      });
    });
  }
}
