import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createDevLoopbackOutboundClientFactory } from './dev-loopback-client.ts'

/**
 * The one substitution this client makes — dial loopback for a host the
 * allowlist named, instead of refusing it as a private address — and nothing
 * else: the allowlist itself still refuses a host that was never named.
 */

let server: Server
let port: number

beforeAll(async () => {
  server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/plain' })
    response.end(`hit ${request.url ?? ''}`)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  port = (server.address() as AddressInfo).port
})

afterAll(async () => {
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

describe('createDevLoopbackOutboundClientFactory', () => {
  it('reaches a host that only resolves to loopback, by dialling the port the URL named', async () => {
    const client = createDevLoopbackOutboundClientFactory()(['oidc-fake.e2e.test'])

    const reply = await client.get({ url: `http://oidc-fake.e2e.test:${String(port)}/discovery` })

    expect(reply.status).toBe(200)
    expect(reply.body).toBe('hit /discovery')
  })

  it('still refuses a host the allowlist was never given', async () => {
    const client = createDevLoopbackOutboundClientFactory()(['oidc-fake.e2e.test'])

    await expect(
      client.get({ url: `http://somewhere-else.test:${String(port)}/discovery` }),
    ).rejects.toThrow('not an allowed outbound host')
  })
})
