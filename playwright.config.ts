import { defineConfig, devices } from '@playwright/test'

import { apiServerEnv } from './e2e/support/env.ts'

const isCI = process.env['CI'] !== undefined

/**
 * Run order for `pnpm test:e2e` (Playwright's own task order — every
 * `webServer` is started and waited on to answer its health/url check
 * *before* any `globalSetup` file runs, not after):
 *
 * 1. `webServer` starts the API server and the Vite dev server, in the
 *    array order below, both left running for every test. The API server
 *    migrates its own database on boot (`main.ts`).
 * 2. `globalSetup` (`e2e/support/global-setup.ts`) seeds that now-migrated
 *    database and content store, with the exact same env the API server
 *    just booted with (`apiServerEnv()`), so what it writes is what the
 *    already-running server reads.
 * 3. Tests run against the Vite dev server, which proxies `/api` to the API
 *    server (`apps/web/vite.config.ts`).
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  /*
   * Capped, because the thing under test is not this machine's CPU: it is one
   * Vite dev server compiling modules on demand and one API process hashing
   * passwords at the Argon2id setting ADR-011 requires. Playwright's default
   * is half the logical cores — twelve browsers on a 24-core machine — and
   * past the point those two processes can answer, the four profiles'
   * journeys start failing on load times instead of on anything about the
   * product. Four is green, and finishes no slower than twelve did, because
   * none of it is spent waiting on a saturated server.
   */
  workers: 4,
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : 'list',
  /*
   * Most of what these journeys wait for is a route: a navigation, its
   * loader's queries, and the render that follows, against a dev server that
   * compiles as it serves. Five seconds is generous for a DOM update and
   * tight for that, and being tight buys nothing — a wrong result fails just
   * as certainly at ten as at five, while a slow-but-correct one stops being
   * reported as a browser difference it never was.
   */
  expect: { timeout: 10_000 },
  globalSetup: './e2e/support/global-setup.ts',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'mobile-safari', use: { ...devices['iPhone 14'] } },
  ],
  webServer: [
    {
      command: 'pnpm --filter @quill/server start',
      url: 'http://localhost:3000/healthz',
      reuseExistingServer: !isCI,
      timeout: 60_000,
      env: apiServerEnv(),
    },
    {
      command: 'pnpm --filter @quill/web dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !isCI,
      timeout: 60_000,
    },
  ],
})
