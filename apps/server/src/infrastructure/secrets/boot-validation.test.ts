import { setSecret } from '@quill/application'
import type { UserId } from '@quill/domain'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { createServerHarness } from '../../test-support/harness.ts'
import type { ServerHarness } from '../../test-support/harness.ts'
import { seedTenancy } from '../../test-support/tenancy-fixture.ts'
import { createEnvelopeCipher } from './envelope-cipher.ts'
import { createLocalKeyProvider } from './key-provider.ts'
import { validateSecretsConfigured } from './boot-validation.ts'
import type { SecretExistenceCheck } from './boot-validation.ts'

/**
 * Boot validation for a secret ADR-034 asks an administrator to enter: does
 * *something* — the store, or the deprecated environment fallback — name a
 * *readable* value, checked without ever opening the ciphertext
 * (`describeSecret`, not `getSecret`).
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

function check(overrides: Partial<SecretExistenceCheck> = {}): SecretExistenceCheck {
  return {
    name: 'oidc/acme/client-secret',
    envVarName: 'OIDC_ACME_CLIENT_SECRET',
    description: 'the "acme" OIDC provider\'s client secret',
    ...overrides,
  }
}

describe('validateSecretsConfigured', () => {
  it('passes silently when the secret is stored', async () => {
    await setSecret(harness.deps, { name: 'oidc/acme/client-secret', value: 'stored', actor })
    const warnings: string[] = []

    await expect(
      validateSecretsConfigured(harness.deps, [check()], (message) => warnings.push(message)),
    ).resolves.toBeUndefined()
    expect(warnings).toEqual([])
  })

  it('warns, naming the secret to set, when only the environment fallback names a value', async () => {
    const warnings: string[] = []

    await validateSecretsConfigured(harness.deps, [check()], (message) => warnings.push(message), {
      OIDC_ACME_CLIENT_SECRET: 'from-the-environment',
    })

    expect(warnings).toEqual([expect.stringContaining('OIDC_ACME_CLIENT_SECRET is deprecated')])
    expect(warnings[0]).toContain('pnpm --filter @quill/server secrets:set oidc/acme/client-secret')
  })

  it('treats an empty environment value the same as an unset one', async () => {
    await expect(
      validateSecretsConfigured(harness.deps, [check()], () => undefined, {
        OIDC_ACME_CLIENT_SECRET: '',
      }),
    ).rejects.toThrow(/the "acme" OIDC provider's client secret is not configured/)
  })

  it('refuses to boot when neither the store nor the environment names a value', async () => {
    await expect(
      validateSecretsConfigured(harness.deps, [check()], () => undefined, {}),
    ).rejects.toThrow(/the "acme" OIDC provider's client secret is not configured/)
    // Never `quill secrets:set`: no package here declares a `bin`.
    await expect(
      validateSecretsConfigured(harness.deps, [check()], () => undefined, {}),
    ).rejects.toThrow(/pnpm --filter @quill\/server secrets:set oidc\/acme\/client-secret/)
  })

  it('checks every configured secret, not just the first', async () => {
    await setSecret(harness.deps, { name: 'oidc/acme/client-secret', value: 'stored', actor })
    const warnings: string[] = []

    await expect(
      validateSecretsConfigured(
        harness.deps,
        [
          check(),
          check({
            name: 'smtp/password',
            envVarName: 'SMTP_PASS',
            description: 'the SMTP password',
          }),
        ],
        (message) => warnings.push(message),
        {},
      ),
    ).rejects.toThrow(/the SMTP password is not configured/)
  })

  describe('a stored secret whose master key this instance no longer holds (fail closed)', () => {
    const OLD_KEY = Buffer.alloc(32, 5)
    const OTHER_KEY = Buffer.alloc(32, 6)

    /** Sealed under a key this test's `harness.deps.secrets` does not hold. */
    async function sealUnderAForeignKey(name: string, value: string): Promise<void> {
      const foreign = createEnvelopeCipher(createLocalKeyProvider([OLD_KEY]))
      await setSecret({ ...harness.deps, secrets: foreign }, { name, value, actor })
    }

    it('refuses to boot: a stored-but-unreadable secret is not treated as configured', async () => {
      await sealUnderAForeignKey('oidc/acme/client-secret', 'stored')

      await expect(
        validateSecretsConfigured(harness.deps, [check()], () => undefined, {}),
      ).rejects.toThrow(/no master key this instance holds can open it/)
    })

    it('names the key id and both remedies in the refusal', async () => {
      await sealUnderAForeignKey('oidc/acme/client-secret', 'stored')
      const keyId = createLocalKeyProvider([OLD_KEY]).currentKeyId

      const error: unknown = await validateSecretsConfigured(
        harness.deps,
        [check()],
        () => undefined,
        {},
      ).catch((caught: unknown) => caught)

      expect(error).toBeInstanceOf(Error)
      const message = error instanceof Error ? error.message : ''
      expect(message).toContain(`key ${keyId}`)
      expect(message).toContain('secrets:rotate')
      expect(message).toContain('secrets:set oidc/acme/client-secret')
    })

    it('warns rather than refusing when the environment fallback still names a value', async () => {
      await sealUnderAForeignKey('oidc/acme/client-secret', 'stored')
      const warnings: string[] = []

      await validateSecretsConfigured(
        harness.deps,
        [check()],
        (message) => warnings.push(message),
        { OIDC_ACME_CLIENT_SECRET: 'from-the-environment' },
      )

      expect(warnings).toEqual([
        expect.stringContaining('no master key this instance holds can open it'),
      ])
      expect(warnings[0]).toContain('Falling back to OIDC_ACME_CLIENT_SECRET')
    })

    it('passes once the current key provider also holds the key that wraps it', async () => {
      // `OLD_KEY` is retired, not lost: this instance's cipher holds both.
      await sealUnderAForeignKey('oidc/acme/client-secret', 'stored')
      const bothKeys = {
        ...harness.deps,
        secrets: createEnvelopeCipher(createLocalKeyProvider([OTHER_KEY, OLD_KEY])),
      }

      await expect(
        validateSecretsConfigured(bothKeys, [check()], () => undefined, {}),
      ).resolves.toBeUndefined()
    })
  })
})
