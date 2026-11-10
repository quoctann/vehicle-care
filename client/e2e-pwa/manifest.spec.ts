import { expect, test } from '@playwright/test';

/**
 * Regression for Android 16 / installed PWA system navigation color.
 * The manifest's theme_color drives the WebAPK default window chrome and
 * system navigation background on many Android builds. It must match the
 * app's light surface; dynamic dark mode is handled at runtime by
 * ThemeColorSync via the meta theme-color tag.
 */
test('production manifest uses the neutral surface for theme and background', async ({
  request,
}) => {
  const response = await request.get('/manifest.webmanifest');
  expect(response.ok()).toBe(true);
  expect(response.headers()['content-type']).toContain('application/manifest+json');

  const manifest = await response.json();
  expect(manifest.theme_color).toBe('#f9f9fb');
  expect(manifest.background_color).toBe('#f9f9fb');
});
