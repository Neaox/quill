import { describe, expect, it } from 'vitest'

import { generateDataKey, KEY_BYTES, KeyLengthError, openWithKey, sealWithKey } from './aes-gcm.ts'

const KEY = Buffer.alloc(KEY_BYTES, 1)
const OTHER_KEY = Buffer.alloc(KEY_BYTES, 2)
const LABEL = 'secret:v1:smtp/password'
const OTHER_LABEL = 'secret:v1:oidc/client-secret'

describe('AES-256-GCM', () => {
  it('round trips a value', () => {
    expect(openWithKey(KEY, sealWithKey(KEY, 'hunter2', LABEL), LABEL)).toBe('hunter2')
  })

  it('round trips text that is not ASCII', () => {
    const value = 'passphrase — naïve café 🔐'
    expect(openWithKey(KEY, sealWithKey(KEY, value, LABEL), LABEL)).toBe(value)
  })

  it('never produces the same ciphertext twice, because the nonce is fresh', () => {
    expect(sealWithKey(KEY, 'hunter2', LABEL)).not.toBe(sealWithKey(KEY, 'hunter2', LABEL))
  })

  it('does not open under the wrong key', () => {
    expect(openWithKey(OTHER_KEY, sealWithKey(KEY, 'hunter2', LABEL), LABEL)).toBeNull()
  })

  /**
   * The associated data is authenticated but not carried: the opener has to
   * state it again, which is what binds a ciphertext to where it is stored.
   */
  it('does not open under a different label, with the right key', () => {
    expect(openWithKey(KEY, sealWithKey(KEY, 'hunter2', LABEL), OTHER_LABEL)).toBeNull()
  })

  it('does not open a ciphertext somebody edited', () => {
    const sealed = Buffer.from(sealWithKey(KEY, 'hunter2', LABEL), 'base64')
    const last = sealed.length - 1
    sealed.writeUInt8(sealed.readUInt8(last) ^ 0xff, last)
    expect(openWithKey(KEY, sealed.toString('base64'), LABEL)).toBeNull()
  })

  it('does not open a payload too short to hold a nonce and a tag', () => {
    expect(openWithKey(KEY, Buffer.alloc(8).toString('base64'), LABEL)).toBeNull()
  })

  it('refuses a key of the wrong length, in both directions', () => {
    expect(() => sealWithKey(Buffer.alloc(16), 'hunter2', LABEL)).toThrow(KeyLengthError)
    expect(() => openWithKey(Buffer.alloc(16), 'anything', LABEL)).toThrow(/is 16/)
  })

  it('generates keys of the right length, and different ones each time', () => {
    const first = generateDataKey()
    expect(first).toHaveLength(KEY_BYTES)
    expect(Buffer.from(first).equals(Buffer.from(generateDataKey()))).toBe(false)
  })
})
