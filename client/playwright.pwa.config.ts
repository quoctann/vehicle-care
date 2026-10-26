import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e-pwa',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  timeout: 60_000,
  reporter: 'list',
  outputDir: 'test-results/pwa',
  use: {
    baseURL: 'http://localhost:4180',
    serviceWorkers: 'allow',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
    channel: process.env.PLAYWRIGHT_CHANNEL,
  },
  webServer: {
    command: 'node e2e-pwa/server.mjs',
    url: 'http://localhost:4180/__pwa/ready',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
