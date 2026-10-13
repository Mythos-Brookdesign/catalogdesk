import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5178', trace: 'retain-on-failure' },
  projects: [
    {
      name: 'desktop',
      testMatch: 'browser.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: 'mobile',
      testMatch: 'browser.spec.ts',
      use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' },
    },
    { name: 'electron', testMatch: /(?:electron|transfer|auth)\.spec\.ts/ },
  ],
  webServer: {
    command: 'npm run dev:web',
    url: 'http://127.0.0.1:5178',
    reuseExistingServer: !process.env.CI,
  },
})
