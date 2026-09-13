import fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import type { IncomingMessage } from 'node:http'

import {
  createRequestIdGenerator,
  MAX_REQUEST_ID_LENGTH,
  registerRequestIdHeader,
} from './request-id.ts'

function rawRequest(headers: Record<string, string | string[] | undefined>): IncomingMessage {
  return { headers } as IncomingMessage
}

const behindProxy = createRequestIdGenerator({ trustProxy: true })
const onTheOpenInternet = createRequestIdGenerator({ trustProxy: false })

describe('createRequestIdGenerator', () => {
  describe('behind a configured proxy', () => {
    it('honours a caller-supplied x-request-id', () => {
      expect(behindProxy(rawRequest({ 'x-request-id': 'abc-123' }))).toBe('abc-123')
    })

    it('takes the first value when the header repeats', () => {
      expect(behindProxy(rawRequest({ 'x-request-id': ['first', 'second'] }))).toBe('first')
    })

    it('generates one when absent', () => {
      expect(behindProxy(rawRequest({})).length).toBeGreaterThan(0)
    })

    it('generates one when the header is empty', () => {
      expect(behindProxy(rawRequest({ 'x-request-id': '' })).length).toBeGreaterThan(0)
    })

    it('refuses an id longer than the cap, rather than logging it', () => {
      const long = 'a'.repeat(MAX_REQUEST_ID_LENGTH + 1)
      expect(behindProxy(rawRequest({ 'x-request-id': long }))).not.toBe(long)
    })

    it('refuses an id carrying anything but the correlation-id charset', () => {
      // A request id is echoed in a header and written into every log line
      // for the request, so control characters and separators do not belong
      // in one (review finding L3).
      for (const hostile of ['a b', 'a\nb', 'a"b', '<script>', 'a;b', 'a,b']) {
        expect(behindProxy(rawRequest({ 'x-request-id': hostile }))).not.toBe(hostile)
      }
    })
  })

  describe('with nothing trusted in front', () => {
    it('ignores the header entirely', () => {
      // The socket peer is the client, and a client does not choose what this
      // server's logs call its request.
      expect(onTheOpenInternet(rawRequest({ 'x-request-id': 'abc-123' }))).not.toBe('abc-123')
    })

    it('still generates one', () => {
      expect(onTheOpenInternet(rawRequest({})).length).toBeGreaterThan(0)
    })
  })
})

describe('registerRequestIdHeader', () => {
  it('echoes the resolved request id back on the response', async () => {
    const app = fastify({ logger: false, genReqId: behindProxy })
    registerRequestIdHeader(app)
    app.get('/', async () => ({ ok: true }))

    const response = await app.inject({
      method: 'GET',
      url: '/',
      headers: { 'x-request-id': 'caller-id' },
    })
    expect(response.headers['x-request-id']).toBe('caller-id')
    await app.close()
  })
})
