import { describe, expect, it } from 'vitest'
import { formatEndpoints, waitForHttp } from './dev-all.ts'

const refused = () => Promise.reject(new Error('ECONNREFUSED'))

describe('formatEndpoints', () => {
  it('lists every URL a developer opens, aligned under its label', () => {
    const text = formatEndpoints([
      { label: 'App', url: 'http://localhost:5173' },
      { label: 'RustFS console', url: 'http://localhost:9001' },
    ])

    expect(text).toBe(
      [
        `  App${' '.repeat(13)}http://localhost:5173`,
        '  RustFS console  http://localhost:9001',
      ].join('\n'),
    )
  })
})

describe('waitForHttp', () => {
  it('resolves once the probe answers, retrying while it refuses', async () => {
    let calls = 0
    const probe = () => {
      calls += 1
      return calls < 3 ? Promise.reject(new Error('ECONNREFUSED')) : Promise.resolve()
    }

    await waitForHttp('http://localhost:1', { probe, intervalMs: 0, timeoutMs: 1000 })

    expect(calls).toBe(3)
  })

  it('rejects naming the URL when it never answers', async () => {
    await expect(
      waitForHttp('http://localhost:1/healthz', { probe: refused, intervalMs: 0, timeoutMs: 20 }),
    ).rejects.toThrow('http://localhost:1/healthz')
  })
})
