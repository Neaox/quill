import { setSecret } from '@quill/application'
import type { UserId } from '@quill/domain'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { createServerHarness } from '../../test-support/harness.ts'
import type { ServerHarness } from '../../test-support/harness.ts'
import { seedTenancy } from '../../test-support/tenancy-fixture.ts'
import { createEnvelopeCipher } from './envelope-cipher.ts'
import { createLocalKeyProvider } from './key-provider.ts'
import { createSecretResolver } from './resolve-secret.ts'

/**
 * The one resolution rule both the OIDC token exchange and the SMTP mailer
 * follow (ADR-034): the secrets store wins when it holds the name, the
 * environment variable is a fallback for one release, and neither is a
 * failure a caller can tell apart from a network error — it just cannot
 * proceed.
 */

let harness: ServerHarness
let actor: UserId

beforeAll(async () => {
  harness = await createServerHarness()
  actor = (await seedTenancy(harness)).admin
}, 30_000)

afterAll(async () => {
  await harness.close()
})

afterEach(async () => {
  await harness.database.pool.query('DELETE FROM secrets')
})

describe('createSecretResolver', () => {
  it('resolves from the secrets store, even when an environment fallback is also given', async () => {
    await setSecret(harness.deps, { name: 'oidc/acme/client-secret', value: 'stored', actor })
    const resolver = createSecretResolver(harness.deps)

    expect(
      await resolver.resolve({
        name: 'oidc/acme/client-secret',
        envVarName: 'OIDC_ACME_CLIENT_SECRET',
        envValue: 'from-the-environment',
      }),
    ).toEqual({ ok: true, value: 'stored' })
  })

  it('falls back to the environment value when the store holds nothing', async () => {
    const resolver = createSecretResolver(harness.deps)

    expect(
      await resolver.resolve({
        name: 'oidc/acme/client-secret',
        envVarName: 'OIDC_ACME_CLIENT_SECRET',
        envValue: 'from-the-environment',
      }),
    ).toEqual({ ok: true, value: 'from-the-environment' })
  })

  it('fails when neither the store nor the environment names a value', async () => {
    const resolver = createSecretResolver(harness.deps)

    expect(
      await resolver.resolve({
        name: 'oidc/acme/client-secret',
        envVarName: 'OIDC_ACME_CLIENT_SECRET',
        envValue: undefined,
      }),
    ).toEqual({ ok: false, reason: 'not-found' })
  })

  it('treats an empty environment value the same as an unset one', async () => {
    const resolver = createSecretResolver(harness.deps)

    expect(
      await resolver.resolve({
        name: 'oidc/acme/client-secret',
        envVarName: 'OIDC_ACME_CLIENT_SECRET',
        envValue: '',
      }),
    ).toEqual({ ok: false, reason: 'not-found' })
  })

  it('fails as unreadable, not falling back to the environment, when a master key can no longer open the row', async () => {
    // Sealed under a key this process does not hold: `getSecret` answers
    // `unreadable`, and the environment fallback must not paper over that —
    // a rotted secret is an operator problem to fix, not a value to guess.
    const other = createEnvelopeCipher(createLocalKeyProvider([Buffer.alloc(32, 9)]))
    await setSecret(
      { ...harness.deps, secrets: other },
      { name: 'oidc/acme/client-secret', value: 'stored', actor },
    )
    const resolver = createSecretResolver(harness.deps)

    expect(
      await resolver.resolve({
        name: 'oidc/acme/client-secret',
        envVarName: 'OIDC_ACME_CLIENT_SECRET',
        envValue: 'from-the-environment',
      }),
    ).toEqual({ ok: false, reason: 'unreadable' })
  })
})
