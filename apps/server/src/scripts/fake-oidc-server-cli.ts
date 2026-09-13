import { createSystemClock } from '../infrastructure/system-clock.ts'
import { startFakeOidcProvider } from '../test-support/fake-oidc-provider.ts'

/**
 * A standalone process wrapping the in-process fake OpenID Connect provider
 * (`test-support/fake-oidc-provider.ts`) — the same one
 * `routes/auth-oidc.integration.test.ts` drives through a vitest harness —
 * for `e2e/sso.spec.ts`, which drives a real browser against a real running
 * `pnpm --filter @quill/server start` process instead.
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

function required(name: string): string {
  const value = process.env[name]
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required to start the fake OIDC provider`)
  }
  return value
}

const port = Number(process.env['E2E_FAKE_OIDC_PORT'] ?? '3197')
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
