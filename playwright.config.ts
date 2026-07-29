import { defineConfig, devices } from '@playwright/test'

const apiCommand = process.platform === 'win32'
  ? 'set "PERSISTENCE_DRIVER=memory" && set "PORT=8787" && set "APP_ORIGIN=http://127.0.0.1:4173" && set "SESSION_COOKIE_SECURE=false" && set "ENFORCE_ORIGIN_CHECK=false" && node_modules\\.bin\\tsx.cmd server/index.ts'
  : "PERSISTENCE_DRIVER=memory PORT=8787 APP_ORIGIN=http://127.0.0.1:4173 SESSION_COOKIE_SECURE=false ENFORCE_ORIGIN_CHECK=false ./node_modules/.bin/tsx server/index.ts"
const webCommand = process.platform === 'win32'
  ? 'node_modules\\.bin\\vite.cmd --host 127.0.0.1'
  : './node_modules/.bin/vite --host 127.0.0.1'
const baseURL = process.env.PRIORILEARN_E2E_BASE_URL ?? 'http://127.0.0.1:4173'
const useExternalServers = Boolean(process.env.PRIORILEARN_E2E_BASE_URL)
  || process.env.PRIORILEARN_E2E_EXTERNAL_SERVERS === 'true'
  || process.platform === 'win32'

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: useExternalServers ? undefined : [
    {
      command: apiCommand,
      url: 'http://127.0.0.1:8787/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: webCommand,
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
})
