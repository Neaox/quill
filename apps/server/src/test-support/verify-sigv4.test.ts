import { createHash } from 'node:crypto'
import { AwsClient } from 'aws4fetch'
import { describe, expect, it } from 'vitest'

import { verifySignature } from './verify-sigv4.ts'
import type { VerifyOptions } from './verify-sigv4.ts'

/**
 * The verifier the fake S3 service uses. It is only worth having if it says no
 * to the things a real service says no to, so this drives it with requests
 * `aws4fetch` really signed and then breaks them one at a time.
 */

const ACCESS_KEY_ID = 'quill'
const SECRET_ACCESS_KEY = 'quillquill'

const client = new AwsClient({
  accessKeyId: ACCESS_KEY_ID,
  secretAccessKey: SECRET_ACCESS_KEY,
  service: 's3',
  region: 'us-east-1',
})

/** A signed request, flattened into what a Node server would see of it. */
async function signed(
  url = 'http://127.0.0.1:9000/quill/ab/cd/object',
  init: RequestInit = { method: 'GET' },
): Promise<VerifyOptions> {
  const request = await client.sign(url, init)
  const body = Buffer.from(await request.arrayBuffer())
  const headers: Record<string, string> = {}
  request.headers.forEach((value, name) => {
    headers[name] = value
  })
  const target = new URL(request.url)
  // `Request` will not let `host` be read back out of its headers — it is a
  // forbidden header name in the fetch standard — but aws4fetch signs it from
  // the URL, and a server sees it on the wire. Putting it back is what makes
  // this reconstruction the request the signature was made over.
  headers['host'] = target.host
  return {
    method: request.method,
    url: `${target.pathname}${target.search}`,
    headers,
    body,
    accessKeyId: ACCESS_KEY_ID,
    secretAccessKey: SECRET_ACCESS_KEY,
    service: 's3',
  }
}

describe('verifySignature', () => {
  it('accepts a request aws4fetch signed', async () => {
    expect(verifySignature(await signed())).toStrictEqual({ valid: true })
  })

  it('accepts a signed body, and checks the declared hash against it', async () => {
    const body = new TextEncoder().encode('the object')
    const options = await signed('http://127.0.0.1:9000/quill/ab/cd/object', {
      method: 'PUT',
      body,
      headers: {
        'content-type': 'image/png',
        'x-amz-content-sha256': createHash('sha256').update(body).digest('hex'),
      },
    })
    expect(verifySignature(options)).toStrictEqual({ valid: true })
  })

  it('accepts a query string, in canonical order', async () => {
    const options = await signed('http://127.0.0.1:9000/quill/ab/cd/object?b=2&a=1')
    expect(verifySignature(options)).toStrictEqual({ valid: true })
  })

  it('refuses a request with no authorization at all', async () => {
    const options = await signed()
    const { authorization: _dropped, ...headers } = options.headers
    expect(verifySignature({ ...options, headers })).toMatchObject({
      valid: false,
      reason: expect.stringContaining('no AWS4-HMAC-SHA256'),
    })
  })

  it('refuses an authorization header that is not the shape it claims', async () => {
    const options = await signed()
    for (const authorization of [
      'Basic abc',
      'AWS4-HMAC-SHA256 Credential=quill/x, SignedHeaders=host, Signature=zz',
      'AWS4-HMAC-SHA256 Credential=quill/20260913/us-east-1/s3/not-a-terminator, SignedHeaders=host, Signature=aa',
    ]) {
      expect(
        verifySignature({ ...options, headers: { ...options.headers, authorization } }),
      ).toMatchObject({ valid: false })
    }
  })

  it('refuses a key it does not know, and a signature for another service', async () => {
    const options = await signed()
    expect(verifySignature({ ...options, accessKeyId: 'somebody-else' })).toMatchObject({
      valid: false,
      reason: expect.stringContaining('unknown access key'),
    })
    expect(verifySignature({ ...options, service: 'sqs' })).toMatchObject({
      valid: false,
      reason: expect.stringContaining('signed for service s3'),
    })
  })

  it('refuses a request with no date or no payload hash', async () => {
    const options = await signed()
    const withoutDate = { ...options.headers }
    delete withoutDate['x-amz-date']
    expect(verifySignature({ ...options, headers: withoutDate })).toMatchObject({
      valid: false,
      reason: expect.stringContaining('no x-amz-date'),
    })

    const withoutHash = { ...options.headers }
    delete withoutHash['x-amz-content-sha256']
    expect(verifySignature({ ...options, headers: withoutHash })).toMatchObject({
      valid: false,
      reason: expect.stringContaining('no x-amz-content-sha256'),
    })
  })

  it('refuses a body that is not the one the hash was signed over', async () => {
    const body = new TextEncoder().encode('the object')
    const options = await signed('http://127.0.0.1:9000/quill/ab/cd/object', {
      method: 'PUT',
      body,
      headers: { 'x-amz-content-sha256': createHash('sha256').update(body).digest('hex') },
    })
    expect(
      verifySignature({ ...options, body: Buffer.from('something else entirely') }),
    ).toMatchObject({ valid: false, reason: expect.stringContaining('does not match the body') })
  })

  it('accepts an unsigned payload, which is the one case the body is not checked', async () => {
    const options = await signed('http://127.0.0.1:9000/quill/ab/cd/object', {
      method: 'PUT',
      body: new TextEncoder().encode('anything'),
      headers: { 'x-amz-content-sha256': 'UNSIGNED-PAYLOAD' },
    })
    expect(verifySignature(options)).toStrictEqual({ valid: true })
  })

  it('refuses a request signed for a different method, path, or secret', async () => {
    const options = await signed()

    expect(verifySignature({ ...options, method: 'DELETE' })).toMatchObject({
      valid: false,
      reason: expect.stringContaining('does not match this request'),
    })
    expect(
      verifySignature({ ...options, url: '/quill/ab/cd/somebody-elses-object' }),
    ).toMatchObject({ valid: false })
    expect(verifySignature({ ...options, secretAccessKey: 'the-wrong-secret' })).toMatchObject({
      valid: false,
    })
  })

  it('refuses a request whose signed header was altered in flight', async () => {
    const options = await signed()

    // `x-amz-date` is in every signature aws4fetch makes, and moving it is
    // what a replay looks like: the same bytes, a different moment.
    expect(
      verifySignature({
        ...options,
        headers: { ...options.headers, 'x-amz-date': '20200101T000000Z' },
      }),
    ).toMatchObject({
      valid: false,
      reason: expect.stringContaining('does not match this request'),
    })

    // And the host, which is what binds a signature to one service.
    expect(
      verifySignature({ ...options, headers: { ...options.headers, host: 'evil.example' } }),
    ).toMatchObject({ valid: false })
  })

  it('reads a header a proxy dropped as empty rather than throwing', async () => {
    const options = await signed()
    const blanked = { ...options.headers }
    delete blanked['host']
    expect(verifySignature({ ...options, headers: blanked })).toMatchObject({ valid: false })
  })
})
