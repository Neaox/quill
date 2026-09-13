import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/**
 * The seeded instance admin's credentials.
 *
 * `apps/server/src/scripts/seed.ts` hardcodes these; e2e specs run outside
 * every package's module graph (they hit the real HTTP API and import no
 * server code — see `content.ts`), so they cannot import that module's
 * constants and restate them here instead. Reading from the environment
 * first, defaulting to what the seed script creates today, means a future
 * seed script that takes its admin credentials from the environment needs
 * no change on this side.
 */
export const ADMIN_EMAIL = process.env['E2E_ADMIN_EMAIL'] ?? 'admin@example.com'
export const ADMIN_PASSWORD = process.env['E2E_ADMIN_PASSWORD'] ?? 'admin-password-change-me'

export interface SeedInfo {
  readonly workspaceId: string
  readonly adminEmail: string
  readonly adminPassword: string
}

/**
 * Where `global-setup.ts` leaves the id of the workspace it seeded, so every
 * spec reads the same result instead of re-running the seed script itself.
 *
 * The OS temp directory, not somewhere under the repo: Playwright's test
 * workers clear its own output directory (`test-results/`) as they start,
 * which runs after `globalSetup` and would race a file left there.
 */
const SEED_RESULT_PATH = path.join(tmpdir(), 'quill-e2e-seed.json')

/**
 * Parses the workspace id `pnpm --filter @quill/server seed` printed and
 * records it for `seedDevelopmentData` to read. Called once, by
 * `global-setup.ts`, before any test runs.
 */
export function recordSeedResult(seedOutput: string): void {
  const match = /Seeded workspace (\S+)/.exec(seedOutput)
  if (match?.[1] === undefined) {
    throw new Error(`Could not find the seeded workspace id in seed output:\n${seedOutput}`)
  }
  const info: SeedInfo = {
    workspaceId: match[1],
    adminEmail: ADMIN_EMAIL,
    adminPassword: ADMIN_PASSWORD,
  }
  writeFileSync(SEED_RESULT_PATH, JSON.stringify(info), 'utf8')
}

/**
 * The workspace `globalSetup` seeded before any test ran.
 *
 * Document creation needs a real, existing `collectionId` (there is no
 * route to create or list a collection on its own — see
 * `features/workspaces/new-document-dialog.tsx`), so a workspace built from
 * nothing through the API cannot have a document created in it. The seed
 * script's "Engineering" workspace already has collections, and is
 * idempotent, so its id is stable across runs.
 */
export function seedDevelopmentData(): SeedInfo {
  let raw: string
  try {
    raw = readFileSync(SEED_RESULT_PATH, 'utf8')
  } catch {
    throw new Error(
      `No seed result at ${SEED_RESULT_PATH}. Playwright's globalSetup ` +
        '(e2e/support/global-setup.ts) seeds the database before any test runs — ' +
        'run through `pnpm test:e2e`, not a spec file directly.',
    )
  }
  return JSON.parse(raw) as SeedInfo
}
