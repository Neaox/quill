import { describe, expect, it, vi } from 'vitest'

import { createOpenWebResolver } from './open-web-resolver.ts'
import type { DnsAnswers } from './open-web-resolver.ts'

function settle(answer: string[] | Error | undefined): Promise<string[]> {
  return answer instanceof Error || answer === undefined
    ? Promise.reject(answer ?? new Error('ENODATA'))
    : Promise.resolve(answer)
}

function dns(answers: { v4?: string[] | Error; v6?: string[] | Error }) {
  const resolve4 = vi.fn<DnsAnswers['resolve4']>(() => settle(answers.v4))
  const resolve6 = vi.fn<DnsAnswers['resolve6']>(() => settle(answers.v6))
  return { answers: { resolve4, resolve6 }, resolve4, resolve6 }
}

describe('createOpenWebResolver', () => {
  it('returns the addresses of both families, so the caller can refuse a host with any private one', async () => {
    const { answers } = dns({ v4: ['93.184.216.34'], v6: ['2606:2800:220:1::1'] })
    expect(await createOpenWebResolver(answers)('example.com')).toEqual([
      '93.184.216.34',
      '2606:2800:220:1::1',
    ])
  })

  it('is satisfied by one family when the other has no records', async () => {
    expect(await createOpenWebResolver(dns({ v4: ['1.1.1.1'] }).answers)('a.example')).toEqual([
      '1.1.1.1',
    ])
    expect(
      await createOpenWebResolver(dns({ v6: ['2606:4700::1111'] }).answers)('a.example'),
    ).toEqual(['2606:4700::1111'])
  })

  it('fails when neither family answers', async () => {
    const resolver = createOpenWebResolver(
      dns({ v4: new Error('ENOTFOUND'), v6: new Error('ENOTFOUND') }).answers,
    )
    await expect(resolver('nowhere.example')).rejects.toThrow('no address records')
  })

  it('fails on an empty answer', async () => {
    await expect(
      createOpenWebResolver(dns({ v4: [], v6: [] }).answers)('empty.example'),
    ).rejects.toThrow('no address records')
  })

  it('queries both families at once rather than one after the other', async () => {
    const { answers, resolve4, resolve6 } = dns({ v4: ['1.1.1.1'], v6: ['2606:4700::1111'] })
    const pending = createOpenWebResolver(answers)('a.example')
    expect(resolve4).toHaveBeenCalledOnce()
    expect(resolve6).toHaveBeenCalledOnce()
    await pending
  })

  it('does not look up an address written as the host, bracketed or not', async () => {
    const { answers, resolve4, resolve6 } = dns({})
    const resolver = createOpenWebResolver(answers)
    expect(await resolver('93.184.216.34')).toEqual(['93.184.216.34'])
    expect(await resolver('[2606:2800:220:1::1]')).toEqual(['2606:2800:220:1::1'])
    expect(await resolver('[::1]')).toEqual(['::1'])
    expect(resolve4).not.toHaveBeenCalled()
    expect(resolve6).not.toHaveBeenCalled()
  })

  it('builds a real resolver by default, without querying until it is used', () => {
    expect(typeof createOpenWebResolver()).toBe('function')
  })
})
