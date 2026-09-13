import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createTestDatabase, type TestDatabase } from '../db/test-database.ts'
import { createSecretRepository } from './secret-repository.ts'

let database: TestDatabase
let secrets: ReturnType<typeof createSecretRepository>

beforeAll(async () => {
  database = await createTestDatabase()
  secrets = createSecretRepository(database.db)
}, 30_000)

afterAll(async () => {
  await database.drop()
})

beforeEach(async () => {
  await database.pool.query('DELETE FROM secrets')
})

const NOW = new Date('2026-01-01T00:00:00.000Z')
const LATER = new Date('2026-02-01T00:00:00.000Z')

const put = (name: string, keyId = 'key-1', now = NOW) =>
  secrets.put({
    name,
    ciphertext: `sealed-${name}`,
    wrappedKey: `wrapped-${keyId}`,
    keyId,
    now,
  })

describe('SecretsRepository', () => {
  it('stores a secret and finds it by name', async () => {
    expect(await put('oidc/entra/client-secret')).toEqual({
      name: 'oidc/entra/client-secret',
      ciphertext: 'sealed-oidc/entra/client-secret',
      wrappedKey: 'wrapped-key-1',
      keyId: 'key-1',
      createdAt: NOW,
      rotatedAt: null,
      rewrappedAt: null,
    })
    expect(await secrets.find('oidc/entra/client-secret')).toMatchObject({ keyId: 'key-1' })
  })

  it('is null for a name nothing is stored under', async () => {
    expect(await secrets.find('nothing')).toBeNull()
  })

  it('replaces a value under the same name, keeping when it was first entered', async () => {
    await put('smtp/password')
    const replaced = await secrets.put({
      name: 'smtp/password',
      ciphertext: 'sealed-again',
      wrappedKey: 'wrapped-key-1',
      keyId: 'key-1',
      now: LATER,
    })
    expect(replaced).toMatchObject({
      ciphertext: 'sealed-again',
      createdAt: NOW,
      rotatedAt: LATER,
      // A new value is wrapped afresh, so the re-wrap stamp starts over.
      rewrappedAt: null,
    })
  })

  it('lists names and key ids, and never ciphertext', async () => {
    await put('smtp/password')
    await put('oidc/secret')
    const listed = await secrets.list()
    expect(listed).toEqual([
      { name: 'oidc/secret', keyId: 'key-1', createdAt: NOW, rotatedAt: null, rewrappedAt: null },
      {
        name: 'smtp/password',
        keyId: 'key-1',
        createdAt: NOW,
        rotatedAt: null,
        rewrappedAt: null,
      },
    ])
    expect(JSON.stringify(listed)).not.toContain('sealed')
  })

  it('re-wraps a data key and leaves the ciphertext and the value stamp alone', async () => {
    await put('smtp/password')
    expect(
      await secrets.rewrap({
        name: 'smtp/password',
        fromKeyId: 'key-1',
        fromWrappedKey: 'wrapped-key-1',
        wrappedKey: 'wrapped-key-2',
        keyId: 'key-2',
        now: LATER,
      }),
    ).toBe(true)
    expect(await secrets.find('smtp/password')).toEqual({
      name: 'smtp/password',
      ciphertext: 'sealed-smtp/password',
      wrappedKey: 'wrapped-key-2',
      keyId: 'key-2',
      createdAt: NOW,
      rotatedAt: null,
      rewrappedAt: LATER,
    })
  })

  /**
   * The compare-and-swap: a rotation that read an envelope an administrator
   * has since replaced must not write the old value's data key over the new
   * value's, which would leave the new value unopenable for ever.
   */
  it('refuses a re-wrap of an envelope the row no longer carries', async () => {
    await put('smtp/password')
    expect(
      await secrets.rewrap({
        name: 'smtp/password',
        fromKeyId: 'key-1',
        fromWrappedKey: 'an-envelope-this-row-never-had',
        wrappedKey: 'wrapped-key-2',
        keyId: 'key-2',
        now: LATER,
      }),
    ).toBe(false)
    expect(await secrets.find('smtp/password')).toMatchObject({
      keyId: 'key-1',
      wrappedKey: 'wrapped-key-1',
      rewrappedAt: null,
    })
  })

  it('refuses a re-wrap of a secret that is not there', async () => {
    expect(
      await secrets.rewrap({
        name: 'gone',
        fromKeyId: 'key-1',
        fromWrappedKey: 'w',
        wrappedKey: 'w2',
        keyId: 'key-2',
        now: NOW,
      }),
    ).toBe(false)
    expect(await secrets.find('gone')).toBeNull()
  })

  it('reports whether a delete removed anything', async () => {
    await put('smtp/password')
    expect(await secrets.delete('smtp/password')).toBe(true)
    expect(await secrets.delete('smtp/password')).toBe(false)
  })

  it('finds the secrets still wrapped with another key, oldest first, up to a limit', async () => {
    await put('older', 'key-1', NOW)
    await put('newer', 'key-1', LATER)
    await put('current', 'key-2', NOW)
    expect(
      (await secrets.listWrappedWithOther({ keyId: 'key-2', limit: 10 })).map((row) => row.name),
    ).toEqual(['older', 'newer'])
    expect(
      (await secrets.listWrappedWithOther({ keyId: 'key-2', limit: 1 })).map((row) => row.name),
    ).toEqual(['older'])
  })

  it('resumes after a cursor rather than from the start', async () => {
    await put('a', 'key-1', NOW)
    await put('b', 'key-1', NOW)
    await put('c', 'key-1', LATER)
    expect(
      (
        await secrets.listWrappedWithOther({
          keyId: 'key-2',
          limit: 10,
          after: { createdAt: NOW, name: 'a' },
        })
      ).map((row) => row.name),
    ).toEqual(['b', 'c'])
    expect(
      await secrets.listWrappedWithOther({
        keyId: 'key-2',
        limit: 10,
        after: { createdAt: LATER, name: 'c' },
      }),
    ).toEqual([])
  })
})
