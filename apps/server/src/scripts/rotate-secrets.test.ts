import { getSecret, setSecret } from '@quill/application'
import type { UserId } from '@quill/domain'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createEnvelopeCipher } from '../infrastructure/secrets/envelope-cipher.ts'
import { createLocalKeyProvider } from '../infrastructure/secrets/key-provider.ts'
import { createServerHarness } from '../test-support/harness.ts'
import type { ServerHarness } from '../test-support/harness.ts'
import { seedTenancy } from '../test-support/tenancy-fixture.ts'
import { rotateSecrets } from './rotate-secrets.ts'

/**
 * The rotation an operator runs, against a real database and the real
 * envelope cipher: the one place the whole procedure — restart with a new
 * key, re-wrap, drop the old one — is exercised end to end.
 */

const OLD_KEY = Buffer.alloc(32, 3)
const NEW_KEY = Buffer.alloc(32, 4)
let harness: ServerHarness
let actor: UserId

beforeAll(async () => {
  harness = await createServerHarness()
  // A real administrator, because `audit_events.actor_user_id` is a foreign
  // key: a rotation is an administrative act with somebody behind it.
  actor = (await seedTenancy(harness)).admin
}, 30_000)

afterAll(async () => {
  await harness.close()
})

beforeEach(async () => {
  // The harness clock does not move, so audit rows from an earlier test tie
  // on created_at and 'the latest one' would be a coin toss.
  await harness.database.pool.query('DELETE FROM secrets')
  await harness.database.pool.query("DELETE FROM audit_events WHERE target_type = 'secret'")
})

/** The same dependencies, with the master keys this deployment now holds. */
const onKeys = (...keys: Buffer[]) => ({
  ...harness.deps,
  secrets: createEnvelopeCipher(createLocalKeyProvider(keys)),
})

describe('rotating the master key', () => {
  it('re-wraps every secret and leaves each one readable under the new key', async () => {
    const before = onKeys(OLD_KEY)
    for (const name of ['oidc/client-secret', 'smtp/password']) {
      await setSecret(before, { name, value: `value-of-${name}`, actor })
    }
    const stored = await harness.deps.uow.repos.secrets.find('smtp/password')

    const lines: string[] = []
    const after = onKeys(NEW_KEY, OLD_KEY)
    const result = await rotateSecrets(after, actor, (line) => lines.push(line))

    expect(result).toMatchObject({ rewrapped: 2, unreadable: [] })
    expect(lines).toEqual([`Re-wrapped 2 secret(s) onto master key ${after.secrets.currentKeyId}.`])
    expect(await getSecret(after, 'smtp/password')).toEqual({
      kind: 'secret',
      value: 'value-of-smtp/password',
    })
    // The ciphertext is untouched; only the wrapped data key moved.
    expect(await harness.deps.uow.repos.secrets.find('smtp/password')).toMatchObject({
      ciphertext: stored?.ciphertext,
      keyId: after.secrets.currentKeyId,
    })
  })

  it('leaves the old key unable to read what it wrapped, once dropped', async () => {
    await setSecret(onKeys(OLD_KEY), {
      name: 'smtp/password',
      value: 'hunter2',
      actor,
    })
    await rotateSecrets(onKeys(NEW_KEY, OLD_KEY), actor, () => undefined)
    expect(await getSecret(onKeys(NEW_KEY), 'smtp/password')).toMatchObject({ kind: 'secret' })
    expect(await getSecret(onKeys(OLD_KEY), 'smtp/password')).toEqual({ kind: 'unreadable' })
  })

  it('says so, by name, when a secret’s old key is no longer held', async () => {
    await setSecret(onKeys(OLD_KEY), { name: 'lost/secret', value: 'hunter2', actor })

    const lines: string[] = []
    const result = await rotateSecrets(onKeys(NEW_KEY), actor, (line) => lines.push(line))

    expect(result).toMatchObject({ rewrapped: 0, unreadable: ['lost/secret'] })
    expect(lines[1]).toContain('lost/secret')
    expect(lines[1]).toContain('entered again')
  })

  it('does nothing on a second run, so it is safe to repeat', async () => {
    await setSecret(onKeys(OLD_KEY), { name: 'smtp/password', value: 'hunter2', actor })
    const after = onKeys(NEW_KEY, OLD_KEY)
    await rotateSecrets(after, actor, () => undefined)
    expect(await rotateSecrets(after, actor, () => undefined)).toMatchObject({ rewrapped: 0 })
  })

  it('audits the rotation without any value in it', async () => {
    await setSecret(onKeys(OLD_KEY), { name: 'smtp/password', value: 'hunter2', actor })
    await rotateSecrets(onKeys(NEW_KEY, OLD_KEY), actor, () => undefined)
    const { rows } = await harness.database.pool.query<{ metadata: unknown }>(
      "SELECT metadata FROM audit_events WHERE type = 'secret.master_key_rotated' ORDER BY created_at DESC LIMIT 1",
    )
    expect(rows[0]?.metadata).toMatchObject({ rewrapped: 1, unreadable: [] })
    expect(JSON.stringify(rows[0]?.metadata)).not.toContain('hunter2')
  })
})
