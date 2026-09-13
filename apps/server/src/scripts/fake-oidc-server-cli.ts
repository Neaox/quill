import { createSystemClock } from '../infrastructure/system-clock.ts'
import { startFakeOidcProvider } from '../test-support/fake-oidc-provider.ts'

/**
 * A standalone process wrapping the in-process fake OpenID Connect provider
 * (`test-support/fake-oidc-provider.ts`) — the same one
 * `routes/auth-oidc.integration.test.ts` drives through a vitest harness —
 * for `e2e/sso.spec.ts`, which drives a real browser against a real running
 * `pnpm --filter @quill/server start` process instead.
 *
 * An identity provider that signs tokens with a self-generated key and
 * authorises anyone who asks has no business running on a production host,
 * so this refuses under `NODE_ENV=production` unconditionally — the same
 * shape as `reset-database-cli.ts`, and for the same reason: the server runs
 * from source (`start: node src/main.ts`, no bundle step), so this script
 * ships in the deployed tree along with everything else in `src/`, and
 * nothing should be one `pnpm` command away from standing it up there.
 * `.dependency-cruiser.cjs` separately keeps `test-support/fake-oidc-provider.ts`
 * out of every *other* non-test file, so this is the one deliberate
 * exception rather than the first of an accidental pattern.
 *
 * `playwright.config.ts` starts this as a third `webServer`, alongside the
 * API and Vite: `E2E_FAKE_OIDC_PORT` is fixed (`e2e/support/env.ts`) so that
 * the API server's own `OIDC_FAKE_ISSUER` — set from the same variable —
 * names the right port before either process starts, and this process's
 * health check is the discovery document a `webServer` polls for `200`.
 *
 * Credentials are also read from the environment, the same variables
 * `e2e/support/env.ts` gives the API server as `OIDC_FAKE_CLIENT_ID` and
 * `OIDC_FAKE_CLIENT_SECRET`, so both processes describe the same provider
 * without either one being told the other's configuration directly.
 */

if (process.env['NODE_ENV'] === 'production') {
  process.stderr.write('Refusing to start the fake OIDC provider under NODE_ENV=production.\n')
  process.exit(1)
}

function required(name: string): string {
  const value = process.env[name]
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required to start the fake OIDC provider`)
  }
  return value
}

/** The same shape `config.ts`'s `parsePort` checks — a typo here must not become `listen(NaN)`. */
function requiredPort(name: string, fallback: number): number {
  const raw = process.env[name]
  const port = Number(raw ?? String(fallback))
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${name} must be an integer between 1 and 65535, received "${raw}"`)
  }
  return port
}

const port = requiredPort('E2E_FAKE_OIDC_PORT', 3197)
const clock = createSystemClock()
const provider = await startFakeOidcProvider({
  clientId: required('FAKE_OIDC_CLIENT_ID'),
  clientSecret: required('FAKE_OIDC_CLIENT_SECRET'),
  now: () => clock.now(),
  port,
})

process.stdout.write(`Fake OIDC provider listening: ${provider.issuer} (port ${String(port)})\n`)

async function shutdown(): Promise<void> {
  await provider.close()
  process.exit(0)
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    void shutdown()
  })
}
