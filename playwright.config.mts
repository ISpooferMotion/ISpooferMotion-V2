import type { PlaywrightTestConfig } from '@playwright/test';

process.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS ??= '--remote-debugging-port=9222';

const config: PlaywrightTestConfig = {
  testDir: './e2e',
  timeout: 30000,
  expect: {
    timeout: 5000,
  },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'html',
  use: {
    actionTimeout: 0,
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'bun run tauri:dev',
    port: 9222,
    reuseExistingServer: !process.env.CI,
    timeout: 300 * 1000,
  },
  projects: [
    {
      name: 'cdp',
    },
  ],
};

export default config;
