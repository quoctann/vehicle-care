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
      expect(body.expected_account_id).toBe(account.id);
      expect(body.device_id).toMatch(/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i);
      registrations.push(body.device_id);
      return route.fulfill({
        json: { account_id: account.id, device_id: body.device_id, registered_at: serverTime },
      });
    }
    if (path === '/sync/push') {
      const body = request.postDataJSON() as PushRequest;
      expect(body.expected_account_id).toBe(account.id);
      pushes.push(body);
      events.push('push');
      expect(body.mutations).toHaveLength(1);
      const mutation = body.mutations[0]!;
      acknowledged = pushes.length > 1;
      return route.fulfill({
        json: {
          account_id: account.id,
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
      expect(url.searchParams.get('expected_account_id')).toBe(account.id);
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
        account_id: account.id,
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

test('a second tab login changes shared cookies but cannot sync the first tab offline mutation into that account', async ({
  page,
  context,
}) => {
  const other = {
    ...account,
    id: 'a2b8a673-e95d-4a30-b788-bf7ad9ed1650',
    email: 'other@example.test',
  };
  const rejected: { expected: string; cookie: string }[] = [];
  const pushes: PushRequest[] = [];
  const feeds: string[] = [];
  await context.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const path = url.pathname.slice(4);
    const cookie = request.headers().cookie ?? '';
    const current = cookie.includes('sid=tab-b')
      ? other
      : cookie.includes('sid=tab-a')
        ? account
        : null;
    if (path === '/auth/session')
      return route.fulfill({
        status: current ? 200 : 401,
        json: current
          ? { account: current }
          : {
              error: {
                code: 'auth_invalid',
                message: 'Sign in',
                retryable: false,
                request_id: 'session',
              },
            },
      });
    if (path === '/auth/login') {
      const signingIn = request.postDataJSON().email === other.email ? other : account;
      const suffix = signingIn.id === account.id ? 'a' : 'b';
      await context.addCookies([
        { name: 'sid', value: `tab-${suffix}`, url: url.origin, httpOnly: true, sameSite: 'Lax' },
        { name: 'csrf_token', value: `csrf-${suffix}`, url: url.origin, sameSite: 'Lax' },
      ]);
      return route.fulfill({ json: { account: signingIn } });
    }
    const expected =
      path === '/sync/pull'
        ? url.searchParams.get('expected_account_id')
        : request.postDataJSON().expected_account_id;
    if (current?.id !== expected) {
      rejected.push({ expected, cookie });
      return route.fulfill({
        status: 409,
        json: {
          error: {
            code: 'validation_failed',
            message: 'The session changed. Refresh and try again.',
            retryable: false,
            request_id: 'stale-tab',
          },
        },
      });
    }
    if (path === '/devices/register')
      return route.fulfill({
        json: {
          account_id: current.id,
          device_id: request.postDataJSON().device_id,
          registered_at: serverTime,
        },
      });
    if (path === '/sync/push') {
      pushes.push(request.postDataJSON());
      throw new Error('No mutation should be pushed in this scenario');
    }
    if (path === '/sync/pull') {
      feeds.push(current.id);
      return route.fulfill({
        json: {
          account_id: current.id,
          changes: [],
          next_cursor: 0,
          until_seq: 0,
          has_more: false,
          server_time: serverTime,
        },
      });
    }
    return route.abort();
  });

  // Keep tab B's anonymous login screen open before A signs in. Cookies are shared,
  // but the two pages deliberately retain separate in-memory session generations.
  const second = await context.newPage();
  await second.goto('/');
  await expect(second.getByLabel('Email', { exact: true })).toBeVisible();
  const garage = new GaragePage(page);
  await garage.signIn();
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    window.dispatchEvent(new Event('offline'));
  });
  await context.setOffline(true);
  await garage.addVehicle();
  const original = (await rows<OutboxItem>(page, 'outbox'))[0]!;
  const device = (await rows<SyncMeta>(page, 'syncMeta')).find(
    (meta) => meta.accountId === account.id,
  )!.deviceId;
  await context.setOffline(false);
  await second.getByLabel('Email', { exact: true }).fill(other.email);
  await second.getByLabel('Mật khẩu', { exact: true }).fill('test-only-password');
  await second.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await rows<SyncMeta>(second, 'syncMeta')).find((meta) => meta.accountId === other.id)
          ?.bootstrapState,
    )
    .toBe('ready');
  const feedsBefore = [...feeds];
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
    window.dispatchEvent(new Event('online'));
  });
  await page.getByRole('button', { name: /thay đổi đang chờ/ }).click();
  await expect.poll(() => rejected.length).toBeGreaterThan(0);
  expect(rejected[0]).toMatchObject({ expected: account.id });
  expect(rejected[0]!.cookie).toContain('sid=tab-b');
  await expect
    .poll(
      async () =>
        (await rows<SyncMeta>(page, 'syncMeta')).find((meta) => meta.accountId === account.id)
          ?.lastSyncError,
    )
    .toContain('Refresh');
  expect(await rows<OutboxItem>(page, 'outbox')).toEqual([original]);
  expect(
    (await rows<SyncMeta>(page, 'syncMeta')).find((meta) => meta.accountId === account.id),
  ).toMatchObject({ deviceId: device, lastSeenSeq: 0 });
  expect((await rows<Vehicle>(page, 'vehicles'))[0]).toMatchObject({
    accountId: account.id,
    id: original.entityId,
    name: 'Offline commuter',
    serverSeq: null,
  });
  expect(pushes).toEqual([]);
  expect(feeds).toEqual(feedsBefore);
  await second.close();
});
