import type { UserId } from '@quill/domain'
import { beforeEach, describe, expect, it } from 'vitest'

import { createFakeClock, createFakeIdGenerator } from '../test-support/fakes.ts'
import {
  createFakeSecretCipher,
  type FakeSecretCipher,
} from '../test-support/fake-secret-cipher.ts'
import {
  createInMemoryUnitOfWork,
  type InMemoryUnitOfWork,
} from '../test-support/in-memory-repositories.ts'
import {
  deleteSecret,
  describeSecret,
  getSecret,
  isSecretName,
  listSecretNames,
  MAX_SECRET_VALUE_LENGTH,
  rotateMasterKey,
  ROTATION_BATCH,
  SECRET_AUDIT_EVENTS,
  setSecret,
  type SecretsDependencies,
} from './secrets.ts'

const ACTOR = 'user-1' as UserId
const NAME = 'oidc/entra/client-secret'
const VALUE = 'a-very-secret-value'

let cipher: FakeSecretCipher
let uow: InMemoryUnitOfWork
let deps: SecretsDependencies

beforeEach(() => {
  cipher = createFakeSecretCipher()
  uow = createInMemoryUnitOfWork()
  deps = {
    uow,
    secrets: cipher,
    clock: createFakeClock(new Date('2026-01-01T00:00:00.000Z')),
    ids: createFakeIdGenerator(),
  }
})

const set = (name = NAME, value = VALUE) => setSecret(deps, { name, value, actor: ACTOR })

describe('names', () => {
  it('are the path-like labels a settings file references', () => {
    expect(isSecretName(NAME)).toBe(true)
  })

  it('are refused when they are not', async () => {
    expect(isSecretName('Not A Name')).toBe(false)
    expect(await set('Not A Name')).toEqual({ kind: 'invalid-name' })
  })

  it('are refused when they are longer than the column holds', async () => {
    expect(await set('a'.repeat(201))).toEqual({ kind: 'invalid-name' })
  })
})

describe('setting a secret', () => {
  it('stores something that is not the value', async () => {
    await set()
    expect(cipher.sealed).toHaveLength(1)
    expect(cipher.sealed[0]).not.toBe(VALUE)
    expect(await uow.repos.secrets.find(NAME)).toMatchObject({ keyId: cipher.currentKeyId })
  })

  it('answers with the name and the key, never the value', async () => {
    const result = await set()
    expect(result).toMatchObject({
      kind: 'set',
      secret: { name: NAME, keyId: 'key-1', rotatedAt: null },
    })
    expect(JSON.stringify(result)).not.toContain(VALUE)
  })

  it('replaces a value already stored under that name', async () => {
    await set()
    await set(NAME, 'the-new-one')
    expect(await getSecret(deps, NAME)).toEqual({ kind: 'secret', value: 'the-new-one' })
  })

  it('refuses an empty value', async () => {
    expect(await set(NAME, '')).toEqual({ kind: 'invalid-value', reason: 'empty' })
  })

  it('refuses a value larger than the field is for', async () => {
    expect(await set(NAME, 'x'.repeat(MAX_SECRET_VALUE_LENGTH + 1))).toEqual({
      kind: 'invalid-value',
      reason: 'too-long',
    })
  })

  it('audits the name and the key id, and nothing that could reconstruct it', async () => {
    await set()
    const row = uow.auditEvents.at(-1)
    expect(row).toMatchObject({
      type: SECRET_AUDIT_EVENTS.set,
      actorUserId: ACTOR,
      targetType: 'secret',
      targetId: NAME,
      metadata: { keyId: 'key-1' },
    })
    const written = JSON.stringify(row)
    expect(written).not.toContain(VALUE)
    expect(written).not.toContain(cipher.sealed[0])
  })
})

describe('reading a secret', () => {
  it('opens it for the caller about to use it', async () => {
    await set()
    expect(await getSecret(deps, NAME)).toEqual({ kind: 'secret', value: VALUE })
  })

  it('says so when there is none', async () => {
    expect(await getSecret(deps, NAME)).toEqual({ kind: 'not-found' })
  })

  it('says so when the master key that wrapped it is gone', async () => {
    await set()
    cipher.forget('key-1')
    expect(await getSecret(deps, NAME)).toEqual({ kind: 'unreadable' })
  })

  it('is not audited: reading one at the moment of use is not an administrative act', async () => {
    await set()
    const before = uow.auditEvents.length
    await getSecret(deps, NAME)
    expect(uow.auditEvents).toHaveLength(before)
  })
})

describe('listing', () => {
  it('answers with names and key ids and no values at all', async () => {
    await set('smtp/password', 'hunter2')
    await set(NAME)
    const listed = await listSecretNames(deps)
    expect(listed.map((secret) => secret.name)).toEqual([NAME, 'smtp/password'])
    expect(JSON.stringify(listed)).not.toContain('hunter2')
    expect(JSON.stringify(listed)).not.toContain(VALUE)
  })

  it('describes one secret without its value', async () => {
    await set()
    expect(await describeSecret(deps, NAME)).toMatchObject({
      kind: 'secret',
      secret: { name: NAME, keyId: 'key-1' },
    })
  })

  it('says when there is nothing to describe', async () => {
    expect(await describeSecret(deps, NAME)).toEqual({ kind: 'not-found' })
  })
})

describe('deleting', () => {
  it('removes it and audits the removal', async () => {
    await set()
    expect(await deleteSecret(deps, NAME, ACTOR)).toEqual({ kind: 'deleted' })
    expect(await getSecret(deps, NAME)).toEqual({ kind: 'not-found' })
    expect(uow.auditEvents.at(-1)).toMatchObject({
      type: SECRET_AUDIT_EVENTS.deleted,
      targetId: NAME,
    })
  })

  it('says so when there was nothing to delete, and audits nothing', async () => {
    expect(await deleteSecret(deps, NAME, ACTOR)).toEqual({ kind: 'not-found' })
    expect(uow.auditEvents).toHaveLength(0)
  })
})

describe('rotating the master key', () => {
  it('re-wraps every secret onto the new key, leaving the ciphertext alone', async () => {
    await set()
    await set('smtp/password', 'hunter2')
    const before = await uow.repos.secrets.find(NAME)

    cipher.rotateTo('key-2')
    expect(await rotateMasterKey(deps, ACTOR)).toEqual({
      rewrapped: 2,
      unreadable: [],
      keyId: 'key-2',
    })

    const after = await uow.repos.secrets.find(NAME)
    expect(after).toMatchObject({ keyId: 'key-2', ciphertext: before?.ciphertext })
    expect(after?.wrappedKey).not.toBe(before?.wrappedKey)
  })

  it('leaves every secret readable afterwards', async () => {
    await set()
    cipher.rotateTo('key-2')
    await rotateMasterKey(deps, ACTOR)
    expect(await getSecret(deps, NAME)).toEqual({ kind: 'secret', value: VALUE })
  })

  it('does nothing when every secret is already on the current key', async () => {
    await set()
    expect(await rotateMasterKey(deps, ACTOR)).toMatchObject({ rewrapped: 0 })
  })

  it('names the secrets whose old key is gone instead of looping on them', async () => {
    await set()
    cipher.forget('key-1')
    cipher.rotateTo('key-2')
    expect(await rotateMasterKey(deps, ACTOR)).toEqual({
      rewrapped: 0,
      unreadable: [NAME],
      keyId: 'key-2',
    })
  })

  it('gets through more secrets than one batch holds', async () => {
    for (let index = 0; index < ROTATION_BATCH + 5; index++) {
      await set(`integration/token-${index}`, `value-${index}`)
    }
    cipher.rotateTo('key-2')
    expect(await rotateMasterKey(deps, ACTOR)).toMatchObject({ rewrapped: ROTATION_BATCH + 5 })
  })

  /**
   * The compare-and-swap earning its place: without it the rotation writes
   * the old value's data key over the new value's, and the new value never
   * opens again.
   */
  it('leaves a secret replaced while it ran alone, and leaves it readable', async () => {
    await set()
    const stale = await uow.repos.secrets.find(NAME)
    if (stale === null) throw new Error('expected the secret to be stored')
    cipher.rotateTo('key-2')
    // The administrator's replacement lands between the rotation's read and
    // its write: the row now holds a different value, already on the new key.
    await set(NAME, 'replaced-underneath')

    const racing: SecretsDependencies = {
      ...deps,
      uow: {
        ...uow,
        repos: {
          ...uow.repos,
          secrets: {
            ...uow.repos.secrets,
            listWrappedWithOther: async ({ after }) => (after === undefined ? [stale] : []),
          },
        },
      },
    }

    expect(await rotateMasterKey(racing, ACTOR)).toMatchObject({ rewrapped: 0, unreadable: [] })
    expect(await getSecret(deps, NAME)).toEqual({ kind: 'secret', value: 'replaced-underneath' })
  })

  it('walks past a secret it cannot read rather than asking for it again', async () => {
    await set('unreadable/one')
    cipher.forget('key-1')
    cipher.rotateTo('key-2')
    await set('readable/two')
    // The unreadable one is older, so a rotation that did not page past it
    // would read it for ever and never reach the second.
    expect(await rotateMasterKey(deps, ACTOR)).toEqual({
      rewrapped: 0,
      unreadable: ['unreadable/one'],
      keyId: 'key-2',
    })
  })

  it('records when a data key was re-wrapped separately from when a value changed', async () => {
    await set()
    expect(await describeSecret(deps, NAME)).toMatchObject({
      secret: { rotatedAt: null, rewrappedAt: null },
    })
    cipher.rotateTo('key-2')
    await rotateMasterKey(deps, ACTOR)
    expect(await describeSecret(deps, NAME)).toMatchObject({
      secret: { rotatedAt: null, rewrappedAt: deps.clock.now() },
    })
  })

  it('audits the rotation with counts and names, never with a value', async () => {
    await set()
    cipher.rotateTo('key-2')
    await rotateMasterKey(deps, ACTOR)
    const row = uow.auditEvents.at(-1)
    expect(row).toMatchObject({
      type: SECRET_AUDIT_EVENTS.masterKeyRotated,
      targetType: 'secret',
      targetId: 'key-2',
      metadata: { rewrapped: 1, unreadable: [] },
    })
    expect(JSON.stringify(row)).not.toContain(VALUE)
  })
})
