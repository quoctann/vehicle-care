import { expect, test, type Page } from '@playwright/test';

async function buildMarker(page: Page) {
  // JS and HTML must both come from the expected production release.
  return page.evaluate(() => {
    const html = document.querySelector('meta[name="pwa-test-build"]')?.getAttribute('content');
    return html === document.documentElement.dataset.pwaBuild ? html : undefined;
  });
}

async function expectBuild(page: Page, version: string) {
  // Locator assertions survive the expected full-page update navigation.
  await expect(page.locator('html')).toHaveAttribute('data-pwa-build', version);
  await expect(page.locator('meta[name="pwa-test-build"]')).toHaveAttribute('content', version);
}

async function workerState(page: Page) {
  return page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return {
      active: registration?.active?.state,
      waiting: registration?.waiting?.state,
      controlled: !!navigator.serviceWorker.controller,
    };
  });
}

test('production A → B waits for consent and never reloads a second tab draft', async ({
  page,
  context,
  request,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect.poll(() => workerState(page)).toMatchObject({ active: 'activated' });
  // First installation does not claim existing pages. A subsequent navigation is controlled.
  await page.reload();
  await expect.poll(() => workerState(page)).toMatchObject({ controlled: true });
  expect(await buildMarker(page)).toBe('A');
  const oldChunk = await page.locator('script[type="module"][src]').getAttribute('src');
  await page.getByLabel('Email', { exact: true }).fill('first-draft@example.test');

  const second = await context.newPage();
  second.on('pageerror', (error) => errors.push(error.message));
  await second.goto('/');
  await expect.poll(() => workerState(second)).toMatchObject({ controlled: true });
  await second.getByLabel('Email', { exact: true }).fill('second-draft@example.test');
  await second.evaluate(() => {
    document.documentElement.dataset.draftDocument = 'original';
  });

  expect((await request.post('/__pwa/build/B')).ok()).toBe(true);
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    await registration!.update();
  });
  await expect.poll(() => workerState(page)).toMatchObject({ waiting: 'installed' });
  const update = page.getByRole('button', { name: 'Cập nhật', exact: true });
  const secondUpdate = second.getByRole('button', { name: 'Cập nhật', exact: true });
  // Both tabs must already have their controlling listeners installed before acceptance.
  await expect(update).toBeVisible();
  await expect(secondUpdate).toBeVisible();
  expect(await buildMarker(page)).toBe('A');
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue('first-draft@example.test');

  page.once('dialog', async (dialog) => {
    expect(dialog.type()).toBe('confirm');
    await dialog.dismiss();
  });
  await update.click();
  await expect.poll(() => workerState(page)).toMatchObject({ waiting: 'installed' });
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue('first-draft@example.test');

  // Cancellation keeps the same prompt and document available for a later choice.
  await expect(update).toBeVisible();
  page.once('dialog', async (dialog) => {
    await dialog.accept();
  });
  await update.click();
  await expectBuild(page, 'B');
  expect(await page.locator('script[type="module"][src]').getAttribute('src')).not.toBe(oldChunk);
  const retainedChunk = await request.get(oldChunk!);
  expect(retainedChunk.ok()).toBe(true);
  expect(retainedChunk.headers()['content-type']).toBe('text/javascript');
  await expect
    .poll(() => workerState(page))
    .toEqual({
      active: 'activated',
      waiting: undefined,
      controlled: true,
    });

  // Poll an explicit controller replacement, not an arbitrary delay.
  await expect
    .poll(() =>
      second.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration();
        return navigator.serviceWorker.controller === registration?.active;
      }),
    )
    .toBe(true);
  expect(await buildMarker(second)).toBe('A');
  await expect(second.getByLabel('Email', { exact: true })).toHaveValue(
    'second-draft@example.test',
  );
  expect(await second.locator('html').getAttribute('data-draft-document')).toBe('original');

  // The deferred tab can opt in even though B is already active.
  second.once('dialog', async (dialog) => {
    await dialog.accept();
  });
  await secondUpdate.click();
  await expectBuild(second, 'B');
  expect(errors).toEqual([]);
});
