import { describe, expect, it } from 'vitest'

import { createFakeSecretCipher } from './fake-secret-cipher.ts'

const NAME = 'smtp/password'

describe('the fake envelope cipher', () => {
  it('seals a value into something that is not the value, and opens it again', async () => {
    const cipher = createFakeSecretCipher()
    const sealed = await cipher.seal(NAME, 'hunter2')
    expect(sealed.ciphertext).not.toContain('hunter2')
    expect(sealed.wrappedKey.keyId).toBe('key-1')
    expect(await cipher.open(NAME, sealed)).toBe('hunter2')
  })

  it('does not open under another name: a row cannot be moved and read', async () => {
    const cipher = createFakeSecretCipher()
    const sealed = await cipher.seal(NAME, 'hunter2')
    expect(await cipher.open('oidc/client-secret', sealed)).toBeNull()
  })

  it('cannot open what a forgotten key wrapped', async () => {
    const cipher = createFakeSecretCipher()
    const sealed = await cipher.seal(NAME, 'hunter2')
    cipher.forget('key-1')
    expect(await cipher.open(NAME, sealed)).toBeNull()
    expect(await cipher.rewrap(sealed)).toBeNull()
  })

  it('re-wraps onto the current key without touching the ciphertext', async () => {
    const cipher = createFakeSecretCipher()
    const sealed = await cipher.seal(NAME, 'hunter2')
    cipher.rotateTo('key-2')
    const rewrapped = await cipher.rewrap(sealed)
    expect(rewrapped).toMatchObject({
      ciphertext: sealed.ciphertext,
      wrappedKey: { keyId: 'key-2' },
    })
    expect(cipher.currentKeyId).toBe('key-2')
    expect(await cipher.open(NAME, rewrapped ?? sealed)).toBe('hunter2')
  })

  it('starts on whichever key it was given', async () => {
    expect(createFakeSecretCipher('key-9').currentKeyId).toBe('key-9')
  })
})
