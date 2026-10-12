/**
 * Brings up everything local development needs in one command: the Docker
 * Compose containers (Postgres, RustFS), the development seed, then the API
 * server and the web app (`pnpm dev`), and prints where to open each and which
 * accounts to sign in with once they answer.
 *
 * Containers are left running when this exits, as `pnpm db:up` leaves them:
 * Postgres keeps its data and starting it again is the slow part. Stop them
 * with `pnpm db:down`.
 *
 * Usage: node scripts/dev-all.ts
 */
import { spawn, spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

import { BRAND } from '@quill/brand'

import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  WRITER_EMAIL,
  WRITER_PASSWORD,
} from '../apps/server/src/scripts/seed-accounts.ts'

interface Endpoint {
  readonly label: string
  readonly url: string
}

interface WaitOptions {
  readonly probe?: (url: string) => Promise<void>
  readonly intervalMs?: number
  readonly timeoutMs?: number
}

const API = 'http://localhost:3000'
const WEB = 'http://localhost:5173'

const ENDPOINTS: readonly Endpoint[] = [
  { label: 'App', url: WEB },
  { label: 'API', url: API },
  { label: 'API docs', url: `${API}/api/docs` },
  { label: 'RustFS console', url: 'http://localhost:9001' },
  { label: 'RustFS S3 API', url: 'http://localhost:9000' },
  { label: 'Postgres', url: `postgres://${BRAND.slug}:${BRAND.slug}@localhost:5432/${BRAND.slug}` },
]

interface Account {
  readonly role: string
  readonly email: string
  readonly password: string
}

const ACCOUNTS: readonly Account[] = [
  { role: 'Admin', email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  { role: 'Editor', email: WRITER_EMAIL, password: WRITER_PASSWORD },
]

/** Rows of cells, every column but the last padded to its widest cell. */
export function formatTable(rows: readonly (readonly string[])[]): string {
  const columns = Math.max(...rows.map((row) => row.length))
  const widths = Array.from({ length: columns }, (_, column) =>
    Math.max(...rows.map((row) => row[column]?.length ?? 0)),
  )
  const lastColumn = columns - 1
  return rows
    .map((row) => {
      const cells = row.map((cell, column) =>
        column === lastColumn ? cell : cell.padEnd(widths[column] ?? 0),
      )
      return `  ${cells.join('  ')}`
    })
    .join('\n')
}

interface BannerContent {
  readonly name: string
  readonly endpoints: readonly Endpoint[]
  readonly accounts: readonly Account[]
}

export function formatBanner({ name, endpoints, accounts }: BannerContent): string {
  return [
    '',
    `${name} is running:`,
    formatTable(endpoints.map(({ label, url }) => [label, url])),
    '',
    'Sign in with:',
    formatTable(accounts.map(({ role, email, password }) => [role, email, password])),
    '',
  ].join('\n')
}

async function fetchOk(url: string): Promise<void> {
  const response = await fetch(url, { signal: AbortSignal.timeout(2000) })
  await response.body?.cancel()
}

/** Resolves when `url` answers with any HTTP response; a refused connection is retried. */
export async function waitForHttp(
  url: string,
  { probe = fetchOk, intervalMs = 500, timeoutMs = 60_000 }: WaitOptions = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (true) {
    try {
      await probe(url)
      return
    } catch (cause) {
      if (Date.now() >= deadline) {
        throw new Error(`${url} did not answer within ${timeoutMs} ms`, { cause })
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }
  }
}

/** Runs a step to completion, or ends the whole script naming what to check. */
function runStep(
  command: string,
  args: readonly string[],
  failure: string,
  stdio: 'inherit' | 'quiet' = 'inherit',
): void {
  // `shell` so Windows resolves pnpm.cmd; the arguments are fixed.
  const { status } = spawnSync(command, args, {
    shell: true,
    stdio: stdio === 'inherit' ? 'inherit' : ['ignore', 'ignore', 'inherit'],
  })
  if (status !== 0) {
    console.error(failure)
    process.exit(status ?? 1)
  }
}

function main(): void {
  runStep('docker', ['compose', 'up', '-d', '--wait'], 'docker compose failed; is Docker running?')
  // Idempotent, and it migrates first, so the accounts printed below exist and
  // the sign-in page works on a fresh database. Its own output repeats those
  // accounts, so it is kept quiet and the banner says it once. `--demo` adds
  // the demo company on top (`apps/server/src/scripts/demo/README.md`).
  runStep(
    'pnpm',
    ['--filter', '@quill/server', process.argv.includes('--demo') ? 'seed:demo' : 'seed'],
    'Seeding the development data failed.',
    'quiet',
  )

  const dev = spawn('pnpm', ['dev'], { stdio: 'inherit', shell: true })
  dev.on('exit', (code) => process.exit(code ?? 0))

  const banner = formatBanner({ name: BRAND.name, endpoints: ENDPOINTS, accounts: ACCOUNTS })
  Promise.all([waitForHttp(`${API}/healthz`), waitForHttp(WEB)]).then(
    () => console.log(banner),
    (error: unknown) => console.error(error instanceof Error ? error.message : error),
  )
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
