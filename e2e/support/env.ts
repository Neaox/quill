import { fileURLToPath } from 'node:url'
import path from 'node:path'

/** This module lives at `e2e/support/env.ts`, two directories below the repo root. */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

const DEFAULT_CONTENT_STORE_PATH = path.join(REPO_ROOT, 'apps/server/data/e2e-content')

/**
 * The environment `globalSetup`'s seed and the API server's `webServer`
 * process both run with, so they read and write the same database and the
 * same content store (`playwright.config.ts` documents the run order).
 *
 * Every value falls back to a sane default so `pnpm test:e2e` works with
 * nothing set, and every value is still overridable by the environment so
 * CI (`.github/workflows/ci.yml`) can point it at its own Postgres service.
 * Filtered to defined values only: Playwright's `webServer.env` wants
 * `Record<string, string>`, not `NodeJS.ProcessEnv`'s `string | undefined`.
 *
 * `CONTENT_STORE` defaults to `filesystem`, not `memory`: the seed script
 * and the API server are two separate processes, and `memory` keeps its
 * repositories in a `Map` that lives only inside one process — seeding
 * would be invisible to the server. `APP_URL` is the *web* dev server's
 * origin, not the API's own: Vite proxies `/api` to :3000 with
 * `changeOrigin: true`, but the browser's `Origin` header on a
 * state-changing request is still :5173, which is what the CSRF plugin has
 * to accept (see `.env.example`).
 *
 * `AUTH_RATE_LIMIT_MAX` is raised because the limiter's two dimensions
 * (`plugins/rate-limit.ts`) are both degenerate under a browser matrix: every
 * profile signs in from 127.0.0.1, and every journey that needs an
 * administrator signs in as the one seeded account, so four browsers running
 * the suite in parallel spend the production budget of ten a minute in the
 * first few seconds and the rest of the run is answered "Too many attempts".
 * That is the harness having one address and one account, not a journey
 * finding anything; backoff itself is proven where it belongs, in
 * `plugins/rate-limit.test.ts` and `routes/auth.integration.test.ts`. The
 * limiter stays registered and the window stays the default — only the
 * budget moves.
 */
export function apiServerEnv(): Record<string, string> {
  const merged: NodeJS.ProcessEnv = {
    ...process.env,
    APP_URL: process.env['APP_URL'] ?? 'http://localhost:5173',
    MAIL_DRIVER: process.env['MAIL_DRIVER'] ?? 'dev',
    AUTH_RATE_LIMIT_MAX: process.env['AUTH_RATE_LIMIT_MAX'] ?? '1000',
    CONTENT_STORE: process.env['CONTENT_STORE'] ?? 'filesystem',
    CONTENT_STORE_PATH: process.env['CONTENT_STORE_PATH'] ?? DEFAULT_CONTENT_STORE_PATH,
    DATABASE_URL: process.env['DATABASE_URL'] ?? 'postgres://quill:quill@localhost:5432/quill',
  }
  return Object.fromEntries(
    Object.entries(merged).filter((entry): entry is [string, string] => entry[1] !== undefined),
  )
}
