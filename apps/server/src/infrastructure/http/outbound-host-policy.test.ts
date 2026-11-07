import { describe, expect, it } from 'vitest'

import { createOutboundHostPolicy } from './outbound-host-policy.ts'

const answers: Readonly<Record<string, readonly string[]>> = {
  'github.com': ['140.82.112.3'],
  'git.internal.example': ['10.0.0.12'],
  'rebound.example': ['93.184.216.34', '169.254.169.254'],
}

function resolve(hostname: string): Promise<readonly string[]> {
  const addresses = answers[hostname]
  return addresses === undefined
    ? Promise.reject(new Error(`${hostname} does not resolve`))
    : Promise.resolve(addresses)
}

describe('createOutboundHostPolicy', () => {
  it('allows a host that resolves only to public addresses', async () => {
    const policy = createOutboundHostPolicy({ resolve })

    await expect(policy.check(new URL('https://github.com/acme/docs.git'))).resolves.toEqual({
      allowed: true,
    })
  })

  it('refuses a host with any private answer, saying why', async () => {
    const policy = createOutboundHostPolicy({ resolve })

    const verdict = await policy.check(new URL('https://rebound.example/docs.git'))

    expect(verdict).toEqual({
      allowed: false,
      reason: expect.stringContaining('may not reach') as unknown,
    })
  })

  it('refuses a host that does not resolve', async () => {
    const policy = createOutboundHostPolicy({ resolve })

    const verdict = await policy.check(new URL('https://nowhere.example/docs.git'))

    expect(verdict).toEqual({
      allowed: false,
      reason: expect.stringContaining('did not resolve') as unknown,
    })
  })

  it('checks an IPv6 literal as the address it is', async () => {
    const policy = createOutboundHostPolicy({ resolve: (host) => Promise.resolve([host]) })

    const verdict = await policy.check(new URL('https://[::1]/docs.git'))

    expect(verdict.allowed).toBe(false)
  })

  it('allows a private host the operator vouched for, by name and in any case', async () => {
    const policy = createOutboundHostPolicy({
      privateHostsAllowed: ['Git.Internal.Example'],
      resolve,
    })

    await expect(policy.check(new URL('https://git.internal.example/docs.git'))).resolves.toEqual({
      allowed: true,
    })
    await expect(policy.check(new URL('https://rebound.example/docs.git'))).resolves.toMatchObject({
      allowed: false,
    })
  })

  it('resolves with DNS when given no resolver', async () => {
    const policy = createOutboundHostPolicy({})

    await expect(policy.check(new URL('https://127.0.0.1/docs.git'))).resolves.toMatchObject({
      allowed: false,
    })
  })
})
