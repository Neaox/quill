import { createPublicKey, verify as verifySignature } from 'node:crypto'
import type { JsonWebKey, KeyObject } from 'node:crypto'

import { hashToken, tokenHashesMatch } from '../tokens.ts'

/**
 * ID token verification (ADR-011: "signature verification against the
 * provider's JWKS with caching and key rotation, issuer and audience checks,
 * clock-skew tolerance").
 *
 * This is deliberately `node:crypto` and not a JOSE library. What a JWT
 * library buys is protection from the classic mistakes — algorithm confusion,
 * `alg: none`, a public key used as an HMAC secret, a `kid` chosen by the
 * attacker — and every one of those is closed here by construction rather
 * than by configuration:
 *
 * - **The algorithm is chosen by us, not by the token.** `ALGORITHMS` is the
 *   whole allowlist; anything else, `none` included, never reaches a verify.
 * - **The key type must match the algorithm**, so an RSA public key can never
 *   be presented for an EC signature or as an HMAC key. There is no symmetric
 *   branch in this module at all, which is what makes that class of attack
 *   unrepresentable rather than merely refused.
 * - **`kid` selects among keys the issuer published**, never a key from the
 *   token, and a token whose `kid` names nothing known is refused so the
 *   caller can refresh the JWKS once and try again (key rotation).
 * - **The allowlist is a null-prototype record**, so a token naming
 *   `__proto__` or `toString` finds nothing rather than inheriting something
 *   from `Object.prototype` and being treated as an algorithm.
 * - **A key must be strong enough to mean anything**: an RSA modulus below
 *   2048 bits and an EC key on a curve the algorithm does not name are
 *   refused, so a provider that publishes a weak key cannot have it used.
 * - **`crit` is refused outright.** It says "you must understand this header
 *   or reject the token", and this module understands none, so rejecting is
 *   the only correct answer.
 *
 * Everything else is claim comparison, which is where the real bugs live and
 * where a library would not have helped. Keeping it here means every branch
 * below is covered by a test in this repository rather than in somebody
 * else's.
 */

/** A JSON Web Key Set, as the provider's `jwks_uri` publishes it. */
export interface Jwks {
  readonly keys: readonly JsonWebKey[]
}

export interface IdTokenClaims extends Readonly<Record<string, unknown>> {
  readonly iss: string
  readonly sub: string
  readonly aud: string | readonly string[]
  readonly exp: number
}

export type VerifyIdTokenResult =
  | { readonly ok: true; readonly claims: IdTokenClaims }
  | { readonly ok: false; readonly reason: VerifyFailure; readonly detail: string }

/**
 * `unknown_key` is separated from the rest because it is the one failure a
 * caller can act on: the provider has rotated its signing key, so refreshing
 * the JWKS and verifying once more is correct. Every other failure is final.
 */
export type VerifyFailure = 'malformed' | 'unknown_key' | 'bad_signature' | 'claim'

export interface VerifyIdTokenInput {
  readonly token: string
  readonly jwks: Jwks
  /** The exact `iss` the discovery document declared. Compared as a string, never parsed. */
  readonly issuer: string
  /** This client's id: `aud` must contain it. */
  readonly audience: string
  /** The nonce this browser's authorisation request carried. */
  readonly nonce: string
  readonly now: Date
  readonly clockSkewMs: number
}

interface Algorithm {
  readonly hash: 'sha256' | 'sha384' | 'sha512'
  readonly kty: 'RSA' | 'EC'
  readonly crv?: string
  /** JWS carries an EC signature as raw `r || s`; Node's default for EC is DER. */
  readonly dsaEncoding?: 'ieee-p1363'
}

/**
 * The only algorithms a token may be signed with. RSASSA-PKCS1-v1_5 and
 * ECDSA over P-256, both with SHA-256: what every provider in the preset
 * registry actually signs with, and nothing that takes a shared secret.
 */
const ALGORITHMS: Readonly<Record<string, Algorithm>> = Object.freeze(
  Object.assign(Object.create(null) as Record<string, Algorithm>, {
    RS256: { hash: 'sha256', kty: 'RSA' },
    ES256: { hash: 'sha256', kty: 'EC', crv: 'P-256', dsaEncoding: 'ieee-p1363' },
  }),
)

/** The allowlist, looked up safely: a name it does not hold answers nothing. */
function algorithmFor(name: string | null): Algorithm | undefined {
  if (name === null) return undefined
  return Object.hasOwn(ALGORITHMS, name) ? ALGORITHMS[name] : undefined
}

/**
 * The OWASP and NIST floor for RSA, in bytes of modulus. A provider that
 * publishes a 1024-bit key is publishing a signature anybody can forge, and
 * accepting it would make every other check here decoration.
 */
const MIN_RSA_MODULUS_BYTES = 256

/**
 * A ceiling on what will even be parsed. A token is a few hundred bytes; a
 * megabyte of base64 is somebody making the server do arithmetic.
 */
const MAX_TOKEN_BYTES = 16 * 1024

const BASE64URL = /^[A-Za-z0-9_-]+$/

function failure(reason: VerifyFailure, detail: string): VerifyIdTokenResult {
  return { ok: false, reason, detail }
}

/** Strict base64url: `Buffer.from` alone accepts padding and standard base64 too. */
function decodeSegment(segment: string): Buffer | null {
  if (!BASE64URL.test(segment)) return null
  return Buffer.from(segment, 'base64url')
}

function decodeJson(segment: string): Record<string, unknown> | null {
  const bytes = decodeSegment(segment)
  if (bytes === null) return null
  try {
    const parsed: unknown = JSON.parse(bytes.toString('utf8'))
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

function stringClaim(claims: Record<string, unknown>, name: string): string | null {
  const value = claims[name]
  return typeof value === 'string' ? value : null
}

/**
 * The published key this token names, or nothing.
 *
 * A key is eligible when it is for signing, its type matches the algorithm
 * the header chose, and — when the header names a `kid` — it is that key. A
 * set with one key and a token with no `kid` is the common single-key case
 * and is allowed; a set with several is not, because "try them all" is how a
 * rotated-out key stays usable.
 */
function selectKey(jwks: Jwks, kid: string | null, algorithm: Algorithm): JsonWebKey | null {
  const eligible = jwks.keys.filter((key) => {
    const use = keyField(key, 'use')
    const alg = keyField(key, 'alg')
    return (
      key.kty === algorithm.kty &&
      (use === undefined || use === 'sig') &&
      (alg === undefined || algorithmFor(alg) === algorithm) &&
      // An EC key must be on the curve the algorithm names; an RSA key must
      // have a modulus worth signing with.
      (algorithm.crv === undefined ? strongEnoughRsa(key) : key.crv === algorithm.crv)
    )
  })
  if (kid !== null) return eligible.find((key) => keyField(key, 'kid') === kid) ?? null
  // No `kid`: a set with one key is unambiguous, and a set with several is
  // not — "try them all" is how a key the issuer has retired stays usable.
  if (eligible.length !== 1) return null
  /* v8 ignore next -- `length === 1` guarantees the element; the fallback is
     only there for `noUncheckedIndexedAccess`. */
  return eligible[0] ?? null
}

/** Whether a published RSA key's modulus is at or above the floor. */
function strongEnoughRsa(key: JsonWebKey): boolean {
  const modulus = keyField(key, 'n')
  if (modulus === undefined || !BASE64URL.test(modulus)) return false
  return Buffer.from(modulus, 'base64url').byteLength >= MIN_RSA_MODULUS_BYTES
}

/** `kid`, `use`, and `alg` reach `JsonWebKey` through its index signature. */
function keyField(key: JsonWebKey, name: string): string | undefined {
  const value = key[name]
  return typeof value === 'string' ? value : undefined
}

function importKey(jwk: JsonWebKey): KeyObject | null {
  try {
    return createPublicKey({ key: jwk, format: 'jwk' })
  } catch {
    // A malformed key in an otherwise well-formed key set: refused rather
    // than thrown, so one bad entry cannot take the sign-in down with a 500.
    return null
  }
}

/**
 * Verifies one audience value, allowing the array form.
 *
 * When several audiences are present the specification requires `azp` to name
 * the client the token was issued for; without that check a token minted for
 * a different client of the same provider would be accepted here.
 */
function audienceAccepted(claims: Record<string, unknown>, audience: string): string | null {
  const aud = claims['aud']
  if (typeof aud === 'string') {
    return aud === audience ? null : 'aud does not name this client'
  }
  if (!Array.isArray(aud) || !aud.every((entry) => typeof entry === 'string')) {
    return 'aud is missing or not a string or array of strings'
  }
  if (!aud.includes(audience)) return 'aud does not name this client'
  if (aud.length > 1 && stringClaim(claims, 'azp') !== audience) {
    return 'aud names several clients and azp is not this one'
  }
  return null
}

/** `exp`, `nbf`, and `iat`, each with the configured skew allowance. */
function timesAccepted(
  claims: Record<string, unknown>,
  now: number,
  skewMs: number,
): string | null {
  const exp = claims['exp']
  if (typeof exp !== 'number' || !Number.isFinite(exp)) return 'exp is missing'
  if (exp * 1000 + skewMs <= now) return 'the token has expired'

  const nbf = claims['nbf']
  if (typeof nbf === 'number' && nbf * 1000 - skewMs > now) return 'the token is not yet valid'

  // A token issued in the future is a clock that disagrees by more than the
  // allowance, and believing it would extend the token's life by that much.
  const iat = claims['iat']
  if (typeof iat === 'number' && iat * 1000 - skewMs > now) return 'iat is in the future'
  return null
}

export function verifyIdToken(input: VerifyIdTokenInput): VerifyIdTokenResult {
  if (input.token.length > MAX_TOKEN_BYTES) {
    return failure('malformed', 'the id token is larger than any real token')
  }
  const parts = input.token.split('.')
  if (parts.length !== 3) {
    return failure('malformed', 'an id token has three dot-separated parts')
  }
  const [headerSegment = '', payloadSegment = '', signatureSegment = ''] = parts

  const header = decodeJson(headerSegment)
  if (header === null) return failure('malformed', 'the header is not base64url JSON')

  // A token that demands an extension be understood is refused: this module
  // understands none, and "ignore it" is precisely what `crit` forbids.
  if (header['crit'] !== undefined) {
    return failure('malformed', 'the header carries a crit extension')
  }

  const algorithmName = stringClaim(header, 'alg')
  const algorithm = algorithmFor(algorithmName)
  if (algorithm === undefined) {
    return failure('malformed', `unsupported signing algorithm ${String(algorithmName)}`)
  }

  const jwk = selectKey(input.jwks, stringClaim(header, 'kid'), algorithm)
  if (jwk === null) {
    return failure('unknown_key', 'no published key matches this token')
  }
  const key = importKey(jwk)
  if (key === null) return failure('unknown_key', 'the published key could not be read')

  const signature = decodeSegment(signatureSegment)
  if (signature === null) return failure('malformed', 'the signature is not base64url')
  // Both segments are checked for shape *before* they are hashed as the
  // signing input, so nothing outside the base64url alphabet ever reaches a
  // verify — and the bytes signed are the exact ones the token carried.
  if (!BASE64URL.test(payloadSegment)) {
    return failure('malformed', 'the payload is not base64url')
  }

  const signed = Buffer.from(`${headerSegment}.${payloadSegment}`, 'latin1')
  const options =
    algorithm.dsaEncoding === undefined ? key : { key, dsaEncoding: algorithm.dsaEncoding }
  if (!verifySignature(algorithm.hash, signed, options, signature)) {
    return failure('bad_signature', 'the signature does not verify against the published key')
  }

  const claims = decodeJson(payloadSegment)
  if (claims === null) return failure('malformed', 'the payload is not base64url JSON')

  // Only now, with the signature proven, is anything in the payload believed.
  if (stringClaim(claims, 'iss') !== input.issuer) {
    return failure('claim', 'iss is not the configured issuer')
  }
  const subject = stringClaim(claims, 'sub')
  if (subject === null || subject.length === 0) {
    return failure('claim', 'sub is missing')
  }
  const audienceProblem = audienceAccepted(claims, input.audience)
  if (audienceProblem !== null) return failure('claim', audienceProblem)

  const timeProblem = timesAccepted(claims, input.now.getTime(), input.clockSkewMs)
  if (timeProblem !== null) return failure('claim', timeProblem)

  // The nonce is what ties this token to the authorisation request this
  // browser made, and it is the only defence against a token replayed from
  // somewhere else entirely (ADR-011).
  const nonce = stringClaim(claims, 'nonce')
  if (nonce === null || !tokenHashesMatch(hashToken(nonce), hashToken(input.nonce))) {
    return failure('claim', 'nonce does not match this sign-in attempt')
  }

  return { ok: true, claims: claims as unknown as IdTokenClaims }
}
