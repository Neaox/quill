import { createSign, generateKeyPairSync } from 'node:crypto'
import type { KeyObject } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'

import { verifyIdToken } from './id-token.ts'
import type { Jwks } from './id-token.ts'

/**
 * The decision table for "may this token be believed" (ADR-011).
 *
 * Every arm is exercised here rather than trusted to a library: this module
 * is the whole of the platform's JWT verification, so the cases a JOSE
 * library would have handled — algorithm confusion, `alg: none`, a `kid`
 * naming a key nobody published, an audience minted for another client — are
 * named and refused here, by test.
 */

const ISSUER = 'https://sso.example.com'
const AUDIENCE = 'quill-client'
const NONCE = 'nonce-for-this-attempt'
const NOW = new Date('2026-01-01T00:00:00.000Z')
const SECONDS = Math.floor(NOW.getTime() / 1000)

interface Signer {
  readonly kid: string
  readonly privateKey: KeyObject
  readonly jwk: Record<string, unknown>
}

function rsaSigner(kid: string): Signer {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  return {
    kid,
    privateKey,
    jwk: { ...(publicKey.export({ format: 'jwk' }) as object), kid, alg: 'RS256', use: 'sig' },
  }
}

function ecSigner(kid: string): Signer {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  return {
    kid,
    privateKey,
    jwk: { ...(publicKey.export({ format: 'jwk' }) as object), kid, alg: 'ES256', use: 'sig' },
  }
}

function base64url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url')
}

function token(
  signer: Signer,
  claims: Record<string, unknown>,
  options: {
    readonly algorithm?: string
    readonly kid?: string | null
    readonly header?: Record<string, unknown>
  } = {},
): string {
  const algorithm = options.algorithm ?? (signer.jwk['alg'] as string)
  const header: Record<string, unknown> = { alg: algorithm, typ: 'JWT', ...options.header }
  if (options.kid !== null) header['kid'] = options.kid ?? signer.kid
  const head = base64url(JSON.stringify(header))
  const payload = base64url(JSON.stringify(claims))
  const signature = createSign('sha256')
    .update(`${head}.${payload}`)
    .sign(
      algorithm === 'ES256'
        ? { key: signer.privateKey, dsaEncoding: 'ieee-p1363' }
        : signer.privateKey,
    )
  return `${head}.${payload}.${signature.toString('base64url')}`
}

function goodClaims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: ISSUER,
    sub: 'subject-1',
    aud: AUDIENCE,
    nonce: NONCE,
    iat: SECONDS,
    exp: SECONDS + 300,
    ...overrides,
  }
}

let rsa: Signer
let ec: Signer
let other: Signer
let jwks: Jwks

beforeAll(() => {
  rsa = rsaSigner('rsa-1')
  ec = ecSigner('ec-1')
  other = rsaSigner('rsa-2')
  jwks = { keys: [rsa.jwk, ec.jwk] }
})

function verify(
  value: string,
  overrides: { readonly jwks?: Jwks; readonly clockSkewMs?: number } = {},
) {
  return verifyIdToken({
    token: value,
    jwks: overrides.jwks ?? jwks,
    issuer: ISSUER,
    audience: AUDIENCE,
    nonce: NONCE,
    now: NOW,
    clockSkewMs: overrides.clockSkewMs ?? 60_000,
  })
}

describe('a token that verifies', () => {
  it('accepts RS256 signed by a published key', () => {
    const result = verify(token(rsa, goodClaims()))
    expect(result.ok).toBe(true)
    expect(result.ok ? result.claims.sub : '').toBe('subject-1')
  })

  it('accepts ES256, whose signature is raw r||s rather than DER', () => {
    expect(verify(token(ec, goodClaims())).ok).toBe(true)
  })

  it('accepts a single-key set with no kid in the header', () => {
    expect(verify(token(rsa, goodClaims(), { kid: null }), { jwks: { keys: [rsa.jwk] } }).ok).toBe(
      true,
    )
  })

  it('accepts an audience array when azp names this client', () => {
    expect(verify(token(rsa, goodClaims({ aud: [AUDIENCE, 'other'], azp: AUDIENCE }))).ok).toBe(
      true,
    )
  })

  it('accepts a token that expired within the skew allowance', () => {
    expect(verify(token(rsa, goodClaims({ exp: SECONDS - 30 }))).ok).toBe(true)
  })

  it('accepts an nbf that has passed', () => {
    expect(verify(token(rsa, goodClaims({ nbf: SECONDS - 10 }))).ok).toBe(true)
  })
})

describe('a token that must not be believed', () => {
  it.each([
    ['not three parts', () => 'a.b'],
    ['a header that is not base64url', () => `not*base64.${base64url('{}')}.x`],
    ['a header that is not JSON', () => `${base64url('nonsense')}.${base64url('{}')}.x`],
    ['a header that is a JSON array', () => `${base64url('[]')}.${base64url('{}')}.x`],
    [
      'alg: none, the oldest trick there is',
      () => `${base64url('{"alg":"none"}')}.${base64url(JSON.stringify(goodClaims()))}.`,
    ],
    ['an algorithm nobody allow-listed', () => token(rsa, goodClaims(), { algorithm: 'HS256' })],
    ['no alg at all', () => `${base64url('{"typ":"JWT"}')}.${base64url('{}')}.x`],
    // A name inherited from `Object.prototype` is not an algorithm; a
    // lookup that answered one would be an allowlist with a hole in it.
    ['an alg of __proto__', () => `${base64url('{"alg":"__proto__"}')}.${base64url('{}')}.x`],
    ['an alg of toString', () => `${base64url('{"alg":"toString"}')}.${base64url('{}')}.x`],
    ['an alg of constructor', () => `${base64url('{"alg":"constructor"}')}.${base64url('{}')}.x`],
    // `crit` says "reject this token unless you understand the extension it
    // names"; this module understands none, so it rejects.
    [
      'a crit header, whatever it names',
      () => token(rsa, goodClaims(), { header: { crit: ['exp'] } }),
    ],
    [
      'a payload that is not base64url',
      () => `${base64url('{"alg":"RS256","kid":"rsa-1"}')}.not*base64.x`,
    ],
  ])('refuses %s as malformed', (_name, make) => {
    const result = verify(make())
    expect(result).toMatchObject({ ok: false, reason: 'malformed' })
  })

  it('refuses a signature that is not base64url', () => {
    const [head, payload] = token(rsa, goodClaims()).split('.')
    const result = verify(`${String(head)}.${String(payload)}.not*base64`)
    expect(result).toMatchObject({ ok: false, reason: 'malformed' })
  })

  it('refuses a payload that is not base64url JSON, after the signature verifies', () => {
    const head = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: rsa.kid }))
    const payload = base64url('not json')
    const signature = createSign('sha256').update(`${head}.${payload}`).sign(rsa.privateKey)
    const result = verify(`${head}.${payload}.${signature.toString('base64url')}`)
    expect(result).toMatchObject({ ok: false, reason: 'malformed' })
  })

  it('refuses a token longer than any real token, before parsing it', () => {
    expect(verify(`${'a'.repeat(17_000)}.b.c`)).toMatchObject({
      ok: false,
      reason: 'malformed',
    })
  })

  it('refuses a kid nobody published, and says so separately so the caller can refresh', () => {
    expect(verify(token(other, goodClaims()))).toMatchObject({
      ok: false,
      reason: 'unknown_key',
    })
  })

  it('refuses a key set with several candidates and no kid to choose between them', () => {
    // Two RSA keys, no `kid`: trying each in turn is how a key the issuer
    // has retired stays usable, so the token is refused instead.
    const twoRsaKeys = { keys: [rsa.jwk, other.jwk] }
    expect(
      verify(token(rsa, goodClaims(), { kid: null }), { jwks: twoRsaKeys as Jwks }),
    ).toMatchObject({ ok: false, reason: 'unknown_key' })
  })

  it('refuses a published key that cannot be read', () => {
    // A modulus long enough to pass the strength floor, and no exponent at
    // all: the key is eligible on paper and still refuses to import, which
    // must be a refusal rather than a 500 on the sign-in path.
    const { e: _dropped, ...withoutExponent } = rsa.jwk
    const unreadable = { keys: [withoutExponent] }
    expect(verify(token(rsa, goodClaims()), { jwks: unreadable as Jwks })).toMatchObject({
      ok: false,
      reason: 'unknown_key',
    })
  })

  it('refuses a key published for encryption rather than signing', () => {
    const encryptionOnly = { keys: [{ ...rsa.jwk, use: 'enc' }] }
    expect(verify(token(rsa, goodClaims()), { jwks: encryptionOnly as Jwks })).toMatchObject({
      ok: false,
      reason: 'unknown_key',
    })
  })

  it('refuses an RSA key whose modulus is below the floor', () => {
    // 1024 bits: a signature anybody with a few CPU-hours can forge, so the
    // key is not eligible however well the token verifies against it.
    const weak = generateKeyPairSync('rsa', { modulusLength: 1024 })
    const weakJwk = {
      ...(weak.publicKey.export({ format: 'jwk' }) as object),
      kid: 'weak-1',
      alg: 'RS256',
      use: 'sig',
    }
    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'weak-1' }))
    const payload = base64url(JSON.stringify(goodClaims()))
    const signature = createSign('sha256').update(`${header}.${payload}`).sign(weak.privateKey)
    const weakToken = `${header}.${payload}.${signature.toString('base64url')}`

    expect(verify(weakToken, { jwks: { keys: [weakJwk] } as Jwks })).toMatchObject({
      ok: false,
      reason: 'unknown_key',
    })
  })

  it('refuses an RSA key with no readable modulus at all', () => {
    const noModulus = { keys: [{ kty: 'RSA', kid: rsa.kid, alg: 'RS256', e: 'AQAB' }] }
    expect(verify(token(rsa, goodClaims()), { jwks: noModulus as Jwks })).toMatchObject({
      ok: false,
      reason: 'unknown_key',
    })
  })

  it('refuses an EC key on the wrong curve', () => {
    const wrongCurve = { keys: [{ ...ec.jwk, crv: 'P-384' }] }
    expect(verify(token(ec, goodClaims()), { jwks: wrongCurve as Jwks })).toMatchObject({
      ok: false,
      reason: 'unknown_key',
    })
  })

  it('refuses a signature made by another key with the same kid', () => {
    const impostor = { keys: [{ ...other.jwk, kid: rsa.kid }] }
    expect(verify(token(rsa, goodClaims()), { jwks: impostor as Jwks })).toMatchObject({
      ok: false,
      reason: 'bad_signature',
    })
  })

  it.each([
    ['another issuer', { iss: 'https://elsewhere.example' }, 'iss is not the configured issuer'],
    ['no subject', { sub: '' }, 'sub is missing'],
    ['another client', { aud: 'somebody-else' }, 'aud does not name this client'],
    [
      'no audience at all',
      { aud: undefined },
      'aud is missing or not a string or array of strings',
    ],
    [
      'an audience array of numbers',
      { aud: [1, 2] },
      'aud is missing or not a string or array of strings',
    ],
    ['an audience array without this client', { aud: ['a', 'b'] }, 'aud does not name this client'],
    [
      'several audiences and no azp',
      { aud: [AUDIENCE, 'other'] },
      'aud names several clients and azp is not this one',
    ],
    ['no expiry', { exp: undefined }, 'exp is missing'],
    ['an expiry long past', { exp: SECONDS - 600 }, 'the token has expired'],
    ['an nbf in the future', { nbf: SECONDS + 600 }, 'the token is not yet valid'],
    ['an iat in the future', { iat: SECONDS + 600 }, 'iat is in the future'],
    [
      'another attempt’s nonce',
      { nonce: 'somebody-else' },
      'nonce does not match this sign-in attempt',
    ],
    ['no nonce at all', { nonce: undefined }, 'nonce does not match this sign-in attempt'],
  ])('refuses %s', (_name, overrides, detail) => {
    const claims = goodClaims(overrides)
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete claims[key]
    }
    expect(verify(token(rsa, claims))).toEqual({ ok: false, reason: 'claim', detail })
  })
})
