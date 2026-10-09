/**
 * Brings up everything local development needs in one command: the Docker
 * Compose containers (Postgres, RustFS), then the API server and the web app
 * (`pnpm dev`), and prints where to open each once they answer.
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

export function formatEndpoints(endpoints: readonly Endpoint[]): string {
  const width = Math.max(...endpoints.map(({ label }) => label.length))
  return endpoints.map(({ label, url }) => `  ${label.padEnd(width)}  ${url}`).join('\n')
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

function startContainers(): void {
  const { status } = spawnSync('docker', ['compose', 'up', '-d', '--wait'], { stdio: 'inherit' })
  if (status !== 0) {
    console.error('docker compose failed; is Docker running?')
    process.exit(status ?? 1)
  }
}

function main(): void {
  startContainers()

  // `shell` so Windows resolves pnpm.cmd; the arguments are fixed.
  const dev = spawn('pnpm', ['dev'], { stdio: 'inherit', shell: true })
  dev.on('exit', (code) => process.exit(code ?? 0))

  Promise.all([waitForHttp(`${API}/healthz`), waitForHttp(WEB)]).then(
    () => console.log(`\n${BRAND.name} is running:\n${formatEndpoints(ENDPOINTS)}\n`),
    (error: unknown) => console.error(error instanceof Error ? error.message : error),
  )
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
