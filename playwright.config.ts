import { defineConfig, devices } from '@playwright/test'

import {
  API_ORIGIN,
  WEB_ORIGIN,
  WEB_PORT,
  apiServerEnv,
  e2eFakeOidcPort,
  fakeOidcServerEnv,
  webServerEnv,
} from './e2e/support/env.ts'

const isCI = process.env['CI'] !== undefined

/**
 * Which web server the journeys run against. `dev` (the default) is the Vite
 * dev server, so a developer's run picks up an edit without a build. `preview`
 * serves `apps/web/dist`, which `pnpm --filter @quill/web build` must have
 * produced first; CI uses it (`.github/workflows/ci.yml`). Under the dev
 * server a route's first load is one request per module (about 520 for the
 * design page), compiled on demand, and on a CI runner that load overlapped
 * the WebKit journeys and missed their ten-second expectations; the build
 * serves a few bundled chunks, and it is what users get.
 */
const webServer = process.env['E2E_WEB_SERVER'] ?? 'dev'
if (webServer !== 'dev' && webServer !== 'preview') {
  throw new Error(`E2E_WEB_SERVER must be "dev" or "preview", received "${webServer}"`)
}

/**
 * Run order for `pnpm test:e2e` (Playwright's own task order — every
 * `webServer` is started and waited on to answer its health/url check
 * *before* any `globalSetup` file runs, not after):
 *
 * 1. `webServer` starts the API server, the web server (Vite's dev or
 *    preview server, `E2E_WEB_SERVER` above), and the
 *    in-process fake OpenID Connect provider `e2e/sso.spec.ts` drives, in
 *    the array order below, all three left running for every test. The API
 *    server's command first empties the run's own database (`db:reset`),
 *    and the server then migrates it on boot (`main.ts`), so every run
 *    starts from nothing. All three are the run's own, on their own ports
 *    and against their own database and content store
 *    (`e2e/support/env.ts`), never a developer's `pnpm dev`.
 * 2. `globalSetup` (`e2e/support/global-setup.ts`) seeds that now-migrated
 *    database and content store, with the exact same env the API server
 *    just booted with (`apiServerEnv()`), so what it writes is what the
 *    already-running server reads.
 * 3. Tests run against the web server, which proxies `/api` to the API
 *    server (`apps/web/vite.config.ts`; the preview server reuses the dev
 *    server's proxy).
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
    baseURL: WEB_ORIGIN,
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
      command: 'pnpm --filter @quill/server e2e:serve',
      url: `${API_ORIGIN}/healthz`,
      reuseExistingServer: !isCI,
      timeout: 60_000,
      env: apiServerEnv(),
    },
    {
      command: `pnpm --filter @quill/web ${webServer} --port ${WEB_PORT} --strictPort`,
      url: WEB_ORIGIN,
      reuseExistingServer: !isCI,
      timeout: 60_000,
      env: webServerEnv(),
    },
    {
      // The fake OpenID Connect provider `e2e/sso.spec.ts` drives
      // (`apps/server/src/scripts/fake-oidc-server-cli.ts`), reused by every
      // other spec's run too since a `webServer` with nothing pointed at it
      // costs nothing beyond the one process.
      command: 'pnpm --filter @quill/server e2e:fake-oidc',
      url: `http://127.0.0.1:${String(e2eFakeOidcPort())}/.well-known/openid-configuration`,
      reuseExistingServer: !isCI,
      timeout: 60_000,
      env: fakeOidcServerEnv(),
    },
  ],
})
