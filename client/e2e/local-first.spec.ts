import { expect, test, type Page } from '@playwright/test';
import type { PushRequest, PullResponse } from '../src/api/contract.types';
import type { OutboxItem, SyncMeta } from '../src/data/db';
import type { Vehicle } from '../src/domain/types';

const account = {
  id: 'c50fa56c-b7a0-43d0-9741-f81565bd2c1d',
  email: 'driver@example.test',
  name: 'Regression Driver',
  timezone: 'UTC+07:00',
  email_verified: true,
};
const serverTime = '2026-10-19T08:00:00.000Z';

/** Inspect the real persisted workspace without importing or changing application state. */
async function rows<T>(page: Page, table: string): Promise<T[]> {
  return page.evaluate((tableName) => {
    return new Promise<T[]>((resolve, reject) => {
      const open = indexedDB.open('vehicle-maintenance');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const database = open.result;
        const transaction = database.transaction(tableName, 'readonly');
        const request = transaction.objectStore(tableName).getAll();
        request.onsuccess = () => resolve(request.result as T[]);
        request.onerror = () => reject(request.error);
        transaction.oncomplete = () => database.close();
      };
    });
  }, table);
}

class GaragePage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async signIn() {
    await this.page.goto('/');
    await this.page.getByLabel('Email', { exact: true }).fill(account.email);
    await this.page.getByLabel('Mật khẩu', { exact: true }).fill('test-only-password');
    await this.page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
    await expect(this.page.getByRole('heading', { name: 'Thêm một chiếc xe' })).toBeVisible();
    await expect
      .poll(async () => (await rows<SyncMeta>(this.page, 'syncMeta'))[0]?.bootstrapState)
      .toBe('ready');
  }

  async addVehicle() {
    await this.page.getByLabel('Tên xe', { exact: true }).fill('Offline commuter');
    await this.page.getByLabel('Biển số').fill('51H-123.45');
    await this.page.getByRole('button', { name: 'Thêm xe', exact: true }).click();
    await expect(this.page).toHaveURL(/\/v\/[\da-f-]+\/home$/);
  }
}

test('login, offline creation, reload, and explicit retry preserve the mutation until push then pull succeeds', async ({
  page,
  context,
}, testInfo) => {
  let authenticated = false;
  let acknowledged = false;
  const pushes: PushRequest[] = [];
  const events: string[] = [];
  const registrations: string[] = [];
  const unexpected: string[] = [];

  // No request can reach a real API or external service, including unhandled endpoints.
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== 'http://localhost:4179') {
      unexpected.push(request.url());
      return route.abort();
    }
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const path = url.pathname.slice(4);
    if (path === '/auth/session') {
      return route.fulfill({
        status: authenticated ? 200 : 401,
        json: authenticated
          ? { account }
          : {
              error: {
                code: 'auth_invalid',
                message: 'Sign in',
                retryable: false,
                request_id: 'e2e-session',
              },
            },
      });
    }
    if (path === '/auth/login') {
      expect(request.postDataJSON()).toEqual({
        email: account.email,
        password: 'test-only-password',
      });
      authenticated = true;
      await context.addCookies([
        { name: 'sid', value: 'e2e-session', url: url.origin, httpOnly: true, sameSite: 'Lax' },
        { name: 'csrf_token', value: 'e2e-csrf', url: url.origin, sameSite: 'Lax' },
      ]);
      return route.fulfill({ json: { account } });
    }
    expect(request.headers().cookie).toContain('sid=e2e-session');
    if (request.method() === 'POST') {
      expect(request.headers()['x-csrf-token']).toBe('e2e-csrf');
    }
    if (path === '/devices/register') {
      const body = request.postDataJSON();
      expect(body.platform).toBe('web');
      expect(body.device_id).toMatch(/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i);
      registrations.push(body.device_id);
      return route.fulfill({ json: { device_id: body.device_id, registered_at: serverTime } });
    }
    if (path === '/sync/push') {
      const body = request.postDataJSON() as PushRequest;
      pushes.push(body);
      events.push('push');
      expect(body.mutations).toHaveLength(1);
      const mutation = body.mutations[0]!;
      acknowledged = pushes.length > 1;
      return route.fulfill({
        json: {
          results: [
            {
              mutation_id: mutation.mutation_id,
              ...(acknowledged
                ? { status: 'applied', server_seq: 1, server_synced_at: serverTime }
                : {
                    status: 'retryable_error',
                    error_code: 'internal_error',
                    error_message: 'Temporary test outage',
                    retryable: true,
                  }),
            },
          ],
        },
      });
    }
    if (path === '/sync/pull') {
      events.push('pull');
      const mutation = pushes.at(-1)?.mutations[0];
      const canonicalChange =
        mutation?.entity_type === 'vehicle'
          ? {
              entity_type: mutation.entity_type,
              entity_id: mutation.entity_id,
              operation: mutation.operation,
              payload: { ...mutation.payload, name: 'Canonical commuter' },
              server_seq: 1,
              server_synced_at: serverTime,
            }
          : null;
      const after = Number(url.searchParams.get('after_seq'));
      const response: PullResponse = {
        changes: acknowledged && canonicalChange && after < 1 ? [canonicalChange] : [],
        next_cursor: acknowledged ? 1 : 0,
        until_seq: acknowledged ? 1 : 0,
        has_more: false,
        server_time: serverTime,
      };
      return route.fulfill({ json: response });
    }
    unexpected.push(request.url());
    return route.abort();
  });

  const garage = new GaragePage(page);
  await garage.signIn();
  expect(registrations).toHaveLength(1);
  expect(await page.evaluate(() => document.cookie)).not.toContain('sid=');
  await context.setOffline(true);
  await garage.addVehicle();
  const pending = (await rows<OutboxItem>(page, 'outbox'))[0]!;
  expect(pending).toMatchObject({
    accountId: account.id,
    entityType: 'vehicle',
    operation: 'create',
    status: 'pending',
  });
  expect(pending.payload).toMatchObject({ name: 'Offline commuter', plate_number: '51H-123.45' });
  expect(pushes).toHaveLength(0);
  await page.screenshot({ path: testInfo.outputPath('offline-vehicle.png') });

  // Reload online with the pending IndexedDB row, not an in-memory application store.
  await context.setOffline(false);
  await page.reload();
  await expect(page.getByText('Offline commuter', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: /Đã đồng bộ|thay đổi đang chờ/ }).click();
  await expect(page.getByRole('button', { name: /Thử lại đồng bộ/ })).toBeVisible();
  expect(pushes).toHaveLength(1);
  expect(pushes[0]?.mutations).toEqual([
    {
      mutation_id: pending.mutationId,
      entity_type: pending.entityType,
      operation: pending.operation,
      entity_id: pending.entityId,
      payload: pending.payload,
    },
  ]);
  expect(events.slice(events.indexOf('push'))).toEqual(['push']);
  expect((await rows<OutboxItem>(page, 'outbox'))[0]).toMatchObject({
    mutationId: pending.mutationId,
    retryCount: 1,
    failureKind: 'retryable',
  });

  await page.getByRole('button', { name: /Thử lại đồng bộ/ }).click();
  await expect(page.getByRole('button', { name: /Đã đồng bộ/ })).toBeVisible();
  expect(pushes).toHaveLength(2);
  expect(pushes[1]).toEqual(pushes[0]);
  expect(events.slice(events.indexOf('push'))).toEqual(['push', 'push', 'pull']);
  expect(new Set(registrations).size).toBe(1);
  expect(await rows(page, 'outbox')).toEqual([]);
  expect((await rows<Vehicle>(page, 'vehicles'))[0]).toMatchObject({
    id: pending.entityId,
    name: 'Canonical commuter',
    serverSeq: 1,
  });
  expect((await rows<SyncMeta>(page, 'syncMeta'))[0]).toMatchObject({
    lastSeenSeq: 1,
    bootstrapState: 'ready',
    lastSyncError: null,
  });
  await expect(page.getByText('Canonical commuter', { exact: true }).first()).toBeVisible();
  expect(unexpected).toEqual([]);
});
