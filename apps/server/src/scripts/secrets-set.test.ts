import { getSecret } from '@quill/application'
import type { UserId } from '@quill/domain'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { createServerHarness } from '../test-support/harness.ts'
import type { ServerHarness } from '../test-support/harness.ts'
import { seedTenancy } from '../test-support/tenancy-fixture.ts'
import { parseSecretsSetArgv, readSecretValue, setSecretValue } from './secrets-set.ts'
import type { StdinLike } from './secrets-set.ts'

/**
 * `pnpm --filter @quill/server secrets:set`, against a real database and the
 * real envelope cipher: an administrator entering the value ADR-034 asks
 * for. The argument-count guard and the terminal-stdin refusal
 * (`secrets-set-cli.ts`'s own logic, `parseSecretsSetArgv` and
 * `readSecretValue`) are proved on their own below, with fakes standing in
 * for `process.argv` and `process.stdin` — a value never once appears on a
 * command line in this file either.
 */

/** A minimal async-iterable stdin: `chunks` joined is the value a real pipe or redirect would deliver. */
function fakeStdin(chunks: readonly string[], isTTY = false): StdinLike {
  return {
    isTTY,
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    },
  }
}

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
  await harness.database.pool.query("DELETE FROM audit_events WHERE target_type = 'secret'")
})

describe('setSecretValue', () => {
  it('stores the value, readable back only through getSecret', async () => {
    const lines: string[] = []

    const outcome = await setSecretValue(
      harness.deps,
      'oidc/acme/client-secret',
      'the-client-secret',
      actor,
      (line) => lines.push(line),
    )

    expect(outcome).toBe('set')
    expect(lines[0]).toContain('Set secret "oidc/acme/client-secret"')
    expect(await getSecret(harness.deps, 'oidc/acme/client-secret')).toEqual({
      kind: 'secret',
      value: 'the-client-secret',
    })
  })

  it('replaces a value already under that name, so rotating a secret is the same command', async () => {
    await setSecretValue(harness.deps, 'smtp/password', 'first', actor, () => undefined)
    await setSecretValue(harness.deps, 'smtp/password', 'second', actor, () => undefined)

    expect(await getSecret(harness.deps, 'smtp/password')).toEqual({
      kind: 'secret',
      value: 'second',
    })
  })

  it('refuses a name that is not a valid secret name, and stores nothing', async () => {
    const lines: string[] = []

    const outcome = await setSecretValue(harness.deps, 'Not A Valid Name', 'value', actor, (line) =>
      lines.push(line),
    )

    expect(outcome).toBe('invalid-name')
    expect(lines[0]).toContain('not a valid secret name')
    expect(await getSecret(harness.deps, 'Not A Valid Name')).toEqual({ kind: 'not-found' })
  })

  it('refuses an empty value read from stdin', async () => {
    const lines: string[] = []

    const outcome = await setSecretValue(
      harness.deps,
      'oidc/acme/client-secret',
      '',
      actor,
      (line) => lines.push(line),
    )
    expect(outcome).toBe('invalid-value')
    expect(lines[0]).toBe('The value read from stdin was empty; nothing was stored.')
    expect(await getSecret(harness.deps, 'oidc/acme/client-secret')).toEqual({ kind: 'not-found' })
  })

  it('refuses a value longer than the secrets store allows', async () => {
    const lines: string[] = []

    const outcome = await setSecretValue(
      harness.deps,
      'oidc/acme/client-secret',
      'x'.repeat(8193),
      actor,
      (line) => lines.push(line),
    )
    expect(outcome).toBe('invalid-value')
    expect(lines[0]).toBe('The value read from stdin is too long; nothing was stored.')
    expect(await getSecret(harness.deps, 'oidc/acme/client-secret')).toEqual({ kind: 'not-found' })
  })

  it('audits the name and the key id, never the value', async () => {
    await setSecretValue(harness.deps, 'oidc/acme/client-secret', 'hunter2', actor, () => undefined)

    const { rows } = await harness.database.pool.query<{ metadata: unknown; target_id: string }>(
      "SELECT metadata, target_id FROM audit_events WHERE type = 'secret.set' ORDER BY created_at DESC LIMIT 1",
    )
    expect(rows[0]?.target_id).toBe('oidc/acme/client-secret')
    expect(JSON.stringify(rows[0]?.metadata)).not.toContain('hunter2')
  })
})

describe('parseSecretsSetArgv (H1: never accepts a value on the command line)', () => {
  it('accepts exactly one argument: the name', () => {
    expect(parseSecretsSetArgv(['oidc/acme/client-secret'])).toEqual({
      ok: true,
      name: 'oidc/acme/client-secret',
    })
  })

  it('refuses no arguments at all', () => {
    const result = parseSecretsSetArgv([])
    expect(result.ok).toBe(false)
    expect(!result.ok && result.message).toContain('Usage:')
  })

  it('refuses a second argument rather than treating it as the value', () => {
    const result = parseSecretsSetArgv(['oidc/acme/client-secret', 'hunter2'])
    expect(result.ok).toBe(false)
    expect(!result.ok && result.message).toContain('never from a command-line argument')
  })
})

describe('readSecretValue (H1: never a prompt this command does not offer)', () => {
  it('reads and joins every chunk stdin delivers', async () => {
    expect(await readSecretValue(fakeStdin(['hun', 'ter2']))).toEqual({
      ok: true,
      value: 'hunter2',
    })
  })

  it('strips exactly one trailing newline, the shell’s and not the secret’s', async () => {
    expect(await readSecretValue(fakeStdin(['hunter2\n']))).toEqual({ ok: true, value: 'hunter2' })
    expect(await readSecretValue(fakeStdin(['hunter2\r\n']))).toEqual({
      ok: true,
      value: 'hunter2',
    })
    expect(await readSecretValue(fakeStdin(['hunter2\n\n']))).toEqual({
      ok: true,
      value: 'hunter2\n',
    })
  })

  it('refuses a terminal stdin rather than hanging until somebody types into it', async () => {
    const result = await readSecretValue(fakeStdin(['anything'], true))
    expect(result.ok).toBe(false)
    expect(!result.ok && result.message).toContain('is a terminal')
  })
})
