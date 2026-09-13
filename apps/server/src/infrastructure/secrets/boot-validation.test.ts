import { setSecret } from '@quill/application'
import type { UserId } from '@quill/domain'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { createServerHarness } from '../../test-support/harness.ts'
import type { ServerHarness } from '../../test-support/harness.ts'
import { seedTenancy } from '../../test-support/tenancy-fixture.ts'
import { validateSecretsConfigured } from './boot-validation.ts'
import type { SecretExistenceCheck } from './boot-validation.ts'

/**
 * Boot validation for a secret ADR-034 asks an administrator to enter: does
 * *something* — the store, or the deprecated environment fallback — name a
 * value, checked without ever opening the ciphertext (`describeSecret`, not
 * `getSecret`).
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
    envValue: undefined,
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

    await validateSecretsConfigured(
      harness.deps,
      [check({ envValue: 'from-the-environment' })],
      (message) => warnings.push(message),
    )

    expect(warnings).toEqual([expect.stringContaining('OIDC_ACME_CLIENT_SECRET is deprecated')])
    expect(warnings[0]).toContain('quill secrets:set oidc/acme/client-secret')
  })

  it('refuses to boot when neither the store nor the environment names a value', async () => {
    await expect(
      validateSecretsConfigured(harness.deps, [check()], () => undefined),
    ).rejects.toThrow(/the "acme" OIDC provider's client secret is not configured/)
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
            envValue: undefined,
            description: 'the SMTP password',
          }),
        ],
        (message) => warnings.push(message),
      ),
    ).rejects.toThrow(/the SMTP password is not configured/)
  })
})
