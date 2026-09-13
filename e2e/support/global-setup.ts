import { execSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'

import { apiServerEnv } from './env.ts'
import { recordSeedResult } from './seed.ts'

/**
 * Playwright's own task order starts every `webServer` — and waits for it
 * to answer its health/url check — *before* running any `globalSetup` file
 * (`playwright.config.ts` has the full sequence), so the API server is
 * already up, and has already migrated the database itself (`main.ts`), by
 * the time this runs.
 *
 * `apps/server/src/scripts/seed-cli.ts` also runs its own migrations (a
 * harmless no-op against an already-migrated database) and talks to
 * Postgres directly rather than over HTTP, so nothing here depends on the
 * server being reachable — it only needs the exact same environment the
 * server booted with (`apiServerEnv`), so both read and write the same
 * database and the same content store.
 */
export default function globalSetup(): void {
  const env = apiServerEnv()

  // A deterministic run: a content store left over from a previous run
  // would otherwise sit next to a freshly dropped-and-recreated database.
  const contentStorePath = env['CONTENT_STORE_PATH']
  if (env['CONTENT_STORE'] === 'filesystem' && contentStorePath !== undefined) {
    rmSync(contentStorePath, { recursive: true, force: true })
    mkdirSync(contentStorePath, { recursive: true })
  }

  // `execSync` (a single command string), not `execFileSync` with an args
  // array: Node warns that combining `shell: true` with an argument array is
  // unescaped concatenation, which only matters for untrusted input — there
  // is none here, but a plain string sidesteps the warning entirely. `pnpm`
  // needs a shell on Windows, where it resolves through a `.cmd` shim.
  const output = execSync('pnpm --filter @quill/server seed', { encoding: 'utf8', env })
  recordSeedResult(output)
}
