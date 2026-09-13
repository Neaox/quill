import { describe, expect, it } from 'vitest'

import { createEnvelopeCipher } from './envelope-cipher.ts'
import { createLocalKeyProvider, keyIdFor } from './key-provider.ts'

const KEY = Buffer.alloc(32, 1)
const NEXT_KEY = Buffer.alloc(32, 2)
const NAME = 'oidc/entra/client-secret'
const OTHER_NAME = 'smtp/password'

const cipherOn = (...keys: Buffer[]) => createEnvelopeCipher(createLocalKeyProvider(keys))

describe('envelope encryption', () => {
  it('round trips a secret', async () => {
    const cipher = cipherOn(KEY)
    const sealed = await cipher.seal(NAME, 'hunter2')
    expect(await cipher.open(NAME, sealed)).toBe('hunter2')
  })

  it('stores nothing that looks like the value', async () => {
    const sealed = await cipherOn(KEY).seal(NAME, 'hunter2')
    expect(sealed.ciphertext).not.toContain('hunter2')
    expect(Buffer.from(sealed.ciphertext, 'base64').toString('utf8')).not.toContain('hunter2')
  })

  it('gives every secret a data key of its own', async () => {
    const cipher = cipherOn(KEY)
    const first = await cipher.seal(NAME, 'hunter2')
    const second = await cipher.seal(NAME, 'hunter2')
    expect(first.wrappedKey.wrapped).not.toBe(second.wrappedKey.wrapped)
    expect(first.ciphertext).not.toBe(second.ciphertext)
  })

  it('records the master key that wrapped it', async () => {
    const sealed = await cipherOn(KEY).seal(NAME, 'hunter2')
    expect(sealed.wrappedKey.keyId).toBe(keyIdFor(KEY))
    expect(cipherOn(KEY).currentKeyId).toBe(keyIdFor(KEY))
  })

  it('cannot open a secret under a different master key', async () => {
    const sealed = await cipherOn(KEY).seal(NAME, 'hunter2')
    expect(await cipherOn(NEXT_KEY).open(NAME, sealed)).toBeNull()
  })

  /**
   * The attack the value's associated data exists for: somebody who can write
   * the table but does not hold the master key moving the SMTP password into
   * the OIDC client secret's row, so the application uses it as one.
   */
  it('cannot open a row that was sealed under another name', async () => {
    const cipher = cipherOn(KEY)
    const sealed = await cipher.seal(OTHER_NAME, 'hunter2')
    expect(await cipher.open(NAME, sealed)).toBeNull()
    expect(await cipher.open(OTHER_NAME, sealed)).toBe('hunter2')
  })

  /**
   * And the wrapped key's: a wrapped data key lifted into a row that claims a
   * different master key does not unwrap, so the two columns cannot be mixed
   * and matched either.
   */
  it('cannot unwrap a data key under a key id it was not wrapped for', async () => {
    const cipher = cipherOn(NEXT_KEY, KEY)
    const sealed = await cipher.seal(NAME, 'hunter2')
    const relabelled = {
      ciphertext: sealed.ciphertext,
      wrappedKey: { keyId: keyIdFor(KEY), wrapped: sealed.wrappedKey.wrapped },
    }
    expect(await cipher.open(NAME, relabelled)).toBeNull()
  })

  it('cannot open a ciphertext somebody edited, even with the right key', async () => {
    const cipher = cipherOn(KEY)
    const sealed = await cipher.seal(NAME, 'hunter2')
    const bytes = Buffer.from(sealed.ciphertext, 'base64')
    const last = bytes.length - 1
    bytes.writeUInt8(bytes.readUInt8(last) ^ 0xff, last)
    expect(await cipher.open(NAME, { ...sealed, ciphertext: bytes.toString('base64') })).toBeNull()
  })

  it('re-wraps onto the new master key, leaving the ciphertext exactly as it was', async () => {
    const sealed = await cipherOn(KEY).seal(NAME, 'hunter2')
    const rotated = cipherOn(NEXT_KEY, KEY)
    const rewrapped = await rotated.rewrap(sealed)
    expect(rewrapped?.ciphertext).toBe(sealed.ciphertext)
    expect(rewrapped?.wrappedKey.keyId).toBe(keyIdFor(NEXT_KEY))
    expect(await rotated.open(NAME, rewrapped ?? sealed)).toBe('hunter2')
  })

  it('reports a secret whose old master key has gone, rather than losing it quietly', async () => {
    const sealed = await cipherOn(KEY).seal(NAME, 'hunter2')
    expect(await cipherOn(NEXT_KEY).rewrap(sealed)).toBeNull()
  })

  it('leaves a re-wrapped secret unreadable to the old key alone', async () => {
    const sealed = await cipherOn(KEY).seal(NAME, 'hunter2')
    const rewrapped = await cipherOn(NEXT_KEY, KEY).rewrap(sealed)
    expect(rewrapped).not.toBeNull()
    expect(await cipherOn(KEY).open(NAME, rewrapped ?? sealed)).toBeNull()
  })
})
