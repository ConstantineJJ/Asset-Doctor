import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  timeout: 60000,
  workers: 1,
  use: {
    baseURL: 'http://localhost:3000',
    viewport: { width: 1366, height: 768 },
    channel: process.platform === 'win32' ? 'msedge' : undefined,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: process.env.ASSET_DOCTOR_TEST_BUILD === '1'
      ? 'npm run preview -- --port 3000 --strictPort'
      : 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI && process.env.ASSET_DOCTOR_TEST_BUILD !== '1',
  },
});
