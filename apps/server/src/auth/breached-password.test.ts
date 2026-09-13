import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'

import type { OutboundReader, OutboundRequest } from '../infrastructure/http/outbound-client.ts'
import { OutboundRequestError } from '../infrastructure/http/outbound-client.ts'
import { createFakeBreachedPasswordChecker } from '../test-support/fakes.ts'
import {
  createDisabledBreachedPasswordChecker,
  createHibpBreachedPasswordChecker,
} from './breached-password.ts'

const RANGE_URL = 'https://api.pwnedpasswords.com/range'

function sha1(value: string): string {
  return createHash('sha1').update(value, 'utf8').digest('hex').toUpperCase()
}

function clientReturning(body: string, status = 200): OutboundReader {
  return { get: vi.fn<OutboundReader['get']>(async () => ({ status, body })) }
}

describe('createHibpBreachedPasswordChecker', () => {
  it('sends only the first five characters of the SHA-1, never the password', async () => {
    const requests: OutboundRequest[] = []
    const client: OutboundReader = {
      async get(request) {
        requests.push(request)
        return { status: 200, body: '' }
      },
    }
    const checker = createHibpBreachedPasswordChecker({ client, rangeApiUrl: RANGE_URL })

    await checker.check('correct horse battery')

    const digest = sha1('correct horse battery')
    expect(requests).toHaveLength(1)
    expect(requests[0]?.url).toBe(`${RANGE_URL}/${digest.slice(0, 5)}`)
    expect(requests[0]?.url).not.toContain(digest.slice(5))
    expect(requests[0]?.url).not.toContain('correct horse battery')
    // Padding hides the size of the real answer from a network observer.
    expect(requests[0]?.headers).toEqual({ 'Add-Padding': 'true' })
  })

  it('reports a password the corpus knows, with its count', async () => {
    const digest = sha1('password1234')
    const client = clientReturning(
      ['0000000000000000000000000000000000:4', `${digest.slice(5)}:2394`].join('\r\n'),
    )
    const checker = createHibpBreachedPasswordChecker({ client, rangeApiUrl: RANGE_URL })
    expect(await checker.check('password1234')).toEqual({ status: 'breached', count: 2394 })
  })

  it('reports a password the corpus does not know', async () => {
    const client = clientReturning('0000000000000000000000000000000000:4')
    const checker = createHibpBreachedPasswordChecker({ client, rangeApiUrl: RANGE_URL })
    expect(await checker.check('a passphrase nobody has')).toEqual({ status: 'ok' })
  })

  it('treats a padding entry, whose count is zero, as a miss', async () => {
    const digest = sha1('padded')
    const client = clientReturning(`${digest.slice(5)}:0`)
    const checker = createHibpBreachedPasswordChecker({ client, rangeApiUrl: RANGE_URL })
    expect(await checker.check('padded')).toEqual({ status: 'ok' })
  })

  it('tolerates a malformed line', async () => {
    const digest = sha1('odd')
    const client = clientReturning(['nonsense', `${digest.slice(5)}`].join('\n'))
    const checker = createHibpBreachedPasswordChecker({ client, rangeApiUrl: RANGE_URL })
    expect(await checker.check('odd')).toEqual({ status: 'ok' })
  })

  it('reports the corpus unavailable on a non-200, so the caller fails open', async () => {
    const client = clientReturning('', 503)
    const checker = createHibpBreachedPasswordChecker({ client, rangeApiUrl: RANGE_URL })
    expect(await checker.check('anything')).toEqual({
      status: 'unavailable',
      reason: 'status_503',
    })
  })

  it('reports the corpus unavailable when the request fails', async () => {
    const client: OutboundReader = {
      async get() {
        throw new OutboundRequestError('timeout', 'too slow')
      },
    }
    const checker = createHibpBreachedPasswordChecker({ client, rangeApiUrl: RANGE_URL })
    expect(await checker.check('anything')).toEqual({
      status: 'unavailable',
      reason: 'OutboundRequestError',
    })
  })

  it('reports the corpus unavailable when something not an Error is thrown', async () => {
    const client: OutboundReader = {
      async get() {
        throw 'nope'
      },
    }
    const checker = createHibpBreachedPasswordChecker({ client, rangeApiUrl: RANGE_URL })
    expect(await checker.check('anything')).toEqual({
      status: 'unavailable',
      reason: 'network_error',
    })
  })
})

describe('createDisabledBreachedPasswordChecker', () => {
  it('always reports unavailable, which callers treat as fail-open', async () => {
    expect(await createDisabledBreachedPasswordChecker().check('x')).toEqual({
      status: 'unavailable',
      reason: 'disabled',
    })
  })
})

describe('createFakeBreachedPasswordChecker', () => {
  it('is an in-memory corpus a test can plant hits in', async () => {
    const checker = createFakeBreachedPasswordChecker(['seeded'])
    expect(await checker.check('seeded')).toEqual({ status: 'breached', count: 1 })
    expect(await checker.check('clean')).toEqual({ status: 'ok' })

    checker.breach('later', 7)
    expect(await checker.check('later')).toEqual({ status: 'breached', count: 7 })
    expect(checker.asked).toEqual(['seeded', 'clean', 'later'])

    checker.makeUnavailable()
    expect(await checker.check('seeded')).toEqual({ status: 'unavailable', reason: 'test' })
  })
})
