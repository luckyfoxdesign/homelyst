import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  // No browsers — pure API testing via request fixture
  projects: [
    {
      name: 'api',
      use: {},
    },
  ],
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:4321',
    // Extra time for cold SQLite queries on first request
    actionTimeout: 10_000,
  },
  // Run tests sequentially — single SQLite DB, no parallel writes
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
});
