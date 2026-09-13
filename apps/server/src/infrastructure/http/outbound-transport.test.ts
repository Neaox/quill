import { createServer } from 'node:http'
import type { AddressInfo, Server } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { ipv6Bytes, isBlockedAddress, nodeFetch, pinnedLookup } from './outbound-client.ts'

/**
 * The transport and the address parser, the two halves of the outbound client
 * that its decision-table tests cannot reach.
 *
 * `nodeFetch` is `node:https`/`node:http` rather than `fetch` for one reason:
 * `fetch` cannot express "connect to *this address* but speak TLS for *that
 * name*", which is exactly what a client that resolves, checks, and then
 * connects has to say (review finding M4). Testing it needs a real socket, so
 * this file runs one on loopback — which is also the only way to prove the
 * pinned lookup is actually used, since the client itself refuses loopback.
 */

let server: Server
let origin: string

beforeAll(async () => {
  server = createServer((request, response) => {
    if (request.url === '/redirect') {
      response.writeHead(302, { location: '/elsewhere' })
      response.end()
      return
    }
    if (request.url === '/repeated-header') {
      response.writeHead(200, { 'set-cookie': ['a=1', 'b=2'], 'content-type': 'text/plain' })
      response.end('ok')
      return
    }
    if (request.url === '/no-body') {
      response.writeHead(204)
      response.end()
      return
    }
    response.writeHead(200, {
      'content-type': 'text/plain',
      'x-echo': request.headers['x-probe'] ?? '',
    })
    response.end('hello from the socket')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  origin = `http://localhost:${address.port}`
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)))
  })
})

function init(overrides: Partial<Parameters<typeof nodeFetch>[1]> = {}) {
  return {
    method: 'GET',
    headers: {},
    redirect: 'manual' as const,
    signal: new AbortController().signal,
    // The hostname is `localhost`; the socket goes where this says.
    addresses: ['127.0.0.1'],
    ...overrides,
  }
}

async function text(body: ReadableStream<Uint8Array> | null): Promise<string> {
  if (body === null) return ''
  const decoder = new TextDecoder()
  let out = ''
  for await (const chunk of body) out += decoder.decode(chunk, { stream: true })
  return out + decoder.decode()
}

describe('nodeFetch', () => {
  it('connects to the pinned address and streams the body back', async () => {
    const response = await nodeFetch(`${origin}/`, init())
    expect(response.status).toBe(200)
    expect(await text(response.body)).toBe('hello from the socket')
  })

  it('sends the headers it is given', async () => {
    const response = await nodeFetch(`${origin}/`, init({ headers: { 'x-probe': 'yes' } }))
    expect(response.headers.get('x-echo')).toBe('yes')
  })

  it('reads a header case-insensitively, and answers null for one that is absent', async () => {
    const response = await nodeFetch(`${origin}/`, init())
    expect(response.headers.get('Content-Type')).toContain('text/plain')
    expect(response.headers.get('x-nothing-here')).toBeNull()
    await text(response.body)
  })

  it('takes the first value of a header that repeats', async () => {
    const response = await nodeFetch(`${origin}/repeated-header`, init())
    expect(response.headers.get('set-cookie')).toBe('a=1')
    await text(response.body)
  })

  it('does not follow a redirect: the caller re-checks every hop itself', async () => {
    const response = await nodeFetch(`${origin}/redirect`, init())
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('/elsewhere')
    await text(response.body)
  })

  it('handles a response with no body', async () => {
    const response = await nodeFetch(`${origin}/no-body`, init())
    expect(response.status).toBe(204)
    expect(await text(response.body)).toBe('')
  })

  it('speaks https when the URL says so', async () => {
    // Nothing is listening, so this fails — but it fails having chosen
    // `node:https`, which is the branch that carries `servername` and so the
    // whole point of pinning the address without breaking certificate checks.
    await expect(nodeFetch('https://localhost:1/', init())).rejects.toThrow(/ECONNREFUSED/)
  })

  it('rejects when the connection fails', async () => {
    await expect(
      // A port nothing is listening on, pinned to loopback.
      nodeFetch('http://localhost:1/', init()),
    ).rejects.toThrow(/ECONNREFUSED/)
  })

  it('answers an aborted request rather than hanging', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(nodeFetch(`${origin}/`, init({ signal: controller.signal }))).rejects.toThrow(
      /abort/i,
    )
  })
})

/**
 * Review finding M5: `::ffff:7f00:1` is loopback written in hexadecimal, and
 * NAT64 and 6to4 carry an IPv4 address inside an IPv6 one. A check on string
 * prefixes missed all three.
 */
describe('ipv6Bytes', () => {
  it('expands a compressed address to sixteen bytes', () => {
    expect([...(ipv6Bytes('::1') ?? [])]).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1])
    expect([...(ipv6Bytes('2001:db8::') ?? [])].slice(0, 4)).toEqual([0x20, 0x01, 0x0d, 0xb8])
  })

  it('expands an address with no compression at all', () => {
    const bytes = ipv6Bytes('2001:0db8:0000:0000:0000:0000:0000:0001')
    expect(bytes?.[0]).toBe(0x20)
    expect(bytes?.[15]).toBe(1)
  })

  it('expands a trailing dotted quad', () => {
    expect([...(ipv6Bytes('::ffff:127.0.0.1') ?? [])].slice(10)).toEqual([0xff, 0xff, 127, 0, 0, 1])
  })

  it('answers null for anything that is not an IPv6 address', () => {
    expect(ipv6Bytes('127.0.0.1')).toBeNull()
    expect(ipv6Bytes('not an address')).toBeNull()
  })
})

describe('isBlockedAddress, on the IPv6 forms a prefix check misses', () => {
  it('blocks IPv4-mapped loopback and metadata in hexadecimal', () => {
    // The spelling the old check let through.
    expect(isBlockedAddress('::ffff:7f00:1')).toBe(true)
    expect(isBlockedAddress('::ffff:a9fe:a9fe')).toBe(true)
    expect(isBlockedAddress('::ffff:127.0.0.1')).toBe(true)
    expect(isBlockedAddress('::ffff:169.254.169.254')).toBe(true)
  })

  it('blocks the deprecated IPv4-compatible form', () => {
    expect(isBlockedAddress('::127.0.0.1')).toBe(true)
  })

  it('blocks NAT64 and 6to4 carrying a private address', () => {
    expect(isBlockedAddress('64:ff9b::169.254.169.254')).toBe(true)
    expect(isBlockedAddress('64:ff9b::7f00:1')).toBe(true)
    // 2002:<ipv4>::/48 — the embedded address is in the next four bytes.
    expect(isBlockedAddress('2002:a9fe:a9fe::1')).toBe(true)
    expect(isBlockedAddress('2002:7f00:1::1')).toBe(true)
  })

  it('blocks Teredo outright, because its embedded address is obfuscated', () => {
    expect(isBlockedAddress('2001:0:4136:e378:8000:63bf:3fff:fdd2')).toBe(true)
  })

  it('still blocks the ranges that mean "inside" in their own right', () => {
    expect(isBlockedAddress('::')).toBe(true)
    expect(isBlockedAddress('::1')).toBe(true)
    expect(isBlockedAddress('fd00::1')).toBe(true)
    expect(isBlockedAddress('fc00::1')).toBe(true)
    expect(isBlockedAddress('fe80::1')).toBe(true)
    expect(isBlockedAddress('ff02::1')).toBe(true)
  })

  it('lets a genuinely public address through, in both families', () => {
    expect(isBlockedAddress('2606:4700:4700::1111')).toBe(false)
    expect(isBlockedAddress('64:ff9b::1.1.1.1')).toBe(false)
    expect(isBlockedAddress('2002:0101:0101::1')).toBe(false)
    expect(isBlockedAddress('93.184.216.34')).toBe(false)
  })
})

/**
 * The lookup is the whole of the rebinding fix (review finding M4): a socket
 * that fell back to real DNS would resolve a second time, which is exactly
 * what a rebinding attack needs.
 */
describe('pinnedLookup', () => {
  it('answers the list form with every approved address', () => {
    const seen: unknown[] = []
    pinnedLookup(['93.184.216.34', '2606:4700::1111'])(
      'example.com',
      { all: true },
      (...args: unknown[]) => seen.push(args),
    )
    expect(seen).toEqual([
      [
        null,
        [
          { address: '93.184.216.34', family: 4 },
          { address: '2606:4700::1111', family: 6 },
        ],
      ],
    ])
  })

  it('answers the single form with the first approved address', () => {
    const seen: unknown[] = []
    pinnedLookup(['93.184.216.34'])('example.com', {}, (...args: unknown[]) => seen.push(args))
    expect(seen).toEqual([[null, '93.184.216.34', 4]])
  })
})
