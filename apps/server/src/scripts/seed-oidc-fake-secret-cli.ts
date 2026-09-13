import { setSecret } from '@quill/application'
import type { UserId } from '@quill/domain'

import { oidcClientSecretName } from '../auth/oidc/provider-config.ts'
import { loadConfig } from '../config.ts'
import { createDatabase } from '../infrastructure/db/connection.ts'
import { runMigrations } from '../infrastructure/db/migrator.ts'
import { createUnitOfWork } from '../infrastructure/repositories/unit-of-work.ts'
import { createEnvelopeCipher } from '../infrastructure/secrets/envelope-cipher.ts'
import { createKeyProvider } from '../infrastructure/secrets/key-provider.ts'
import { createSystemClock } from '../infrastructure/system-clock.ts'
import { createUuidGenerator } from '../infrastructure/uuid-generator.ts'

/**
 * Part of `e2e:serve`, run once before `main.ts` starts listening — never a
 * script an administrator reaches for.
 *
 * `e2e/sso.spec.ts` is meant to prove the secrets-store path
 * (`infrastructure/secrets/resolve-secret.ts`), not the deprecated
 * environment fallback, so `e2e/support/env.ts` does not give the API server
 * `OIDC_FAKE_CLIENT_SECRET` at all. But boot validation
 * (`infrastructure/secrets/boot-validation.ts`) runs *inside* `main.ts`'s own
 * startup, before it is listening — and therefore before Playwright's
 * `globalSetup` (which runs only once every `webServer` is already healthy)
 * ever gets a chance to write anything into the same database. This script
 * closes that gap: it runs its own migration (idempotent, like every other
 * script here), writes the fake provider's client secret under the name
 * `provider-config.ts` computes for it, and only then does `e2e:serve` start
 * `main.ts` — which finds the secret already in the store on its very first
 * boot, and every token exchange during the run resolves it from there too.
 *
 * `setSecret` needs only `{ uow, secrets, clock, ids }`
 * (`SecretsDependencies`), so unlike every other script in this package this
 * one wires nothing else — no content store, no mailer, no identity
 * provider registry.
 *
 * `E2E_OIDC_FAKE_CLIENT_SECRET_SEED` is not `OIDC_FAKE_CLIENT_SECRET`: it is
 * read by this script alone, never by `provider-config.ts`'s environment
 * fallback, so its presence cannot be mistaken for the thing this exists to
 * stop testing.
 */

function required(name: string): string {
  const value = process.env[name]
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required to seed the fake OIDC provider's client secret`)
  }
  return value
}

const secretValue = required('E2E_OIDC_FAKE_CLIENT_SECRET_SEED')
const secretName = oidcClientSecretName('fake')

const config = loadConfig()
const clock = createSystemClock()
const ids = createUuidGenerator()
const database = createDatabase({ connectionString: config.databaseUrl })
await runMigrations(database.pool)
const uow = createUnitOfWork(database.db, database.pool, ids)
const secrets = createEnvelopeCipher(await createKeyProvider(config.masterKey))

try {
  const result = await setSecret(
    { uow, secrets, clock, ids },
    { name: secretName, value: secretValue, actor: null as unknown as UserId },
  )
  if (result.kind !== 'set') {
    process.stderr.write(`Could not seed "${secretName}": ${result.kind}\n`)
    process.exitCode = 1
  } else {
    process.stdout.write(`Seeded secret "${secretName}" for the e2e run.\n`)
  }
} finally {
  await database.close()
}
