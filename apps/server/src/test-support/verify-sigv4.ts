import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type { IncomingHttpHeaders } from 'node:http'

/**
 * Signature Version 4, checked the way a service checks it.
 *
 * Used by `s3-blob-store.test.ts`'s fake S3. A fake that merely noticed an
 * `Authorization` header would pass for an adapter that signed the wrong
 * request — the wrong method, the wrong path, a header it forgot to include —
 * and every one of those is a `403` from a real service and a green test here.
 * So this derives the signing key from the secret, rebuilds the canonical
 * request from what actually arrived, and compares: the same four steps AWS
 * documents, and the same answer.
 *
 * Test support, so it lives here rather than in the adapter: nothing in the
 * running server verifies a signature, only produces one.
 */

export interface SignatureVerification {
  readonly valid: boolean
  /** What went wrong, for a failing test to read. */
  readonly reason?: string
}

export interface VerifyOptions {
  readonly method: string
  /** The request target, path and query, exactly as it arrived. */
  readonly url: string
  readonly headers: IncomingHttpHeaders
  readonly body: Buffer
  readonly accessKeyId: string
  readonly secretAccessKey: string
  readonly service: string
}

interface Credential {
  readonly accessKeyId: string
  readonly date: string
  readonly region: string
  readonly service: string
}

interface ParsedAuthorization {
  readonly credential: Credential
  readonly signedHeaders: readonly string[]
  readonly signature: string
}

const AUTHORIZATION =
  /^AWS4-HMAC-SHA256 Credential=(?<credential>[^,]+), ?SignedHeaders=(?<signed>[^,]+), ?Signature=(?<signature>[0-9a-f]+)$/u

function parseAuthorization(header: string | undefined): ParsedAuthorization | null {
  const match = header === undefined ? null : AUTHORIZATION.exec(header)
  const groups = match?.groups
  if (groups === undefined) return null

  const credential = groups['credential']
  const signed = groups['signed']
  const signature = groups['signature']
  /* v8 ignore next -- the pattern requires all three groups, so a match has them. */
  if (credential === undefined || signed === undefined || signature === undefined) return null

  const [accessKeyId, date, region, service, terminator] = credential.split('/')
  if (
    accessKeyId === undefined ||
    date === undefined ||
    region === undefined ||
    service === undefined ||
    terminator !== 'aws4_request'
  ) {
    return null
  }
  return {
    credential: { accessKeyId, date, region, service },
    signedHeaders: signed.split(';'),
    signature,
  }
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value, 'utf8').digest()
}

/** The four-step derivation: secret, date, region, service, terminator. */
function signingKey(secret: string, date: string, region: string, service: string): Buffer {
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, date), region), service), 'aws4_request')
}

/**
 * The canonical request: method, path, query, the signed headers in order,
 * the list of their names, and the payload hash.
 */
function canonicalRequest(
  options: VerifyOptions,
  signedHeaders: readonly string[],
  payloadHash: string,
): string {
  const [path = '/', query = ''] = options.url.split('?')
  const canonicalQuery = query
    .split('&')
    .filter((pair) => pair !== '')
    .toSorted()
    .join('&')
  const headers = signedHeaders
    .map((name) => `${name}:${String(options.headers[name] ?? '').trim()}\n`)
    .join('')

  return [options.method, path, canonicalQuery, headers, signedHeaders.join(';'), payloadHash].join(
    '\n',
  )
}

function equal(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8')
  const b = Buffer.from(right, 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Whether this request carries a signature the given credentials would produce. */
export function verifySignature(options: VerifyOptions): SignatureVerification {
  const parsed = parseAuthorization(
    typeof options.headers.authorization === 'string' ? options.headers.authorization : undefined,
  )
  if (parsed === null) return { valid: false, reason: 'no AWS4-HMAC-SHA256 authorization header' }

  const { credential, signedHeaders, signature } = parsed
  if (credential.accessKeyId !== options.accessKeyId) {
    return { valid: false, reason: `unknown access key ${credential.accessKeyId}` }
  }
  if (credential.service !== options.service) {
    return { valid: false, reason: `signed for service ${credential.service}` }
  }

  const amzDate = options.headers['x-amz-date']
  if (typeof amzDate !== 'string') return { valid: false, reason: 'no x-amz-date header' }

  // The payload hash the client declared. A service recomputes it from the
  // body it received, which is what catches a body altered in flight — and
  // what makes the adapter's habit of sending the object's own hash useful.
  const declared = options.headers['x-amz-content-sha256']
  if (typeof declared !== 'string')
    return { valid: false, reason: 'no x-amz-content-sha256 header' }
  if (declared !== 'UNSIGNED-PAYLOAD' && declared !== sha256(options.body)) {
    return { valid: false, reason: 'x-amz-content-sha256 does not match the body' }
  }

  const scope = `${credential.date}/${credential.region}/${credential.service}/aws4_request`
  const toSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256(canonicalRequest(options, signedHeaders, declared)),
  ].join('\n')

  const expected = hmac(
    signingKey(options.secretAccessKey, credential.date, credential.region, credential.service),
    toSign,
  ).toString('hex')

  return equal(expected, signature)
    ? { valid: true }
    : { valid: false, reason: 'the signature does not match this request' }
}
