import { defineConfig, devices } from '@playwright/test';

// E2E tests run against `vite preview` (production build), bound to :4173
// by default. Playwright auto-starts the server before tests and tears
// down after. Override PLAYWRIGHT_BASE_URL to run against a different
// origin (e.g. https://lokl.txid.uk for a production smoke).
//
// Single project: chromium. lokl relies on File System Access API + OPFS
// which firefox/webkit either lack or partially implement. Cross-browser
// fallback-path coverage is a separate future cycle.

const PORT = 4173;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never' }]]
    : [['list']],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: `npm run build && npm run preview -- --port ${PORT}`,
        url: `http://localhost:${PORT}`,
        timeout: 120_000,
        reuseExistingServer: !process.env.CI,
      },
});
