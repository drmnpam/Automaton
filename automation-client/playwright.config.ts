import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: 'http://127.0.0.1:5180',
    headless: true,
    viewport: { width: 1280, height: 800 },
    actionTimeout: 15_000,
    ignoreHTTPSErrors: true,
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5180',
    port: 5180,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
