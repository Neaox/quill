import { describe, expect, it } from 'vitest'
import { formatBanner, formatTable, waitForHttp } from './dev-all.ts'

const refused = () => Promise.reject(new Error('ECONNREFUSED'))

describe('formatTable', () => {
  it('aligns every column but the last to its widest cell', () => {
    const text = formatTable([
      ['App', 'http://localhost:5173'],
      ['RustFS console', 'http://localhost:9001'],
    ])

    expect(text.split('\n')).toEqual([
      `  App${' '.repeat(13)}http://localhost:5173`,
      '  RustFS console  http://localhost:9001',
    ])
  })

  it('aligns three columns, and leaves no trailing space on the last', () => {
    const text = formatTable([
      ['Admin', 'a@example.com', 'secret-one'],
      ['Editor', 'writer@example.com', 'secret-two'],
    ])

    expect(text.split('\n')).toEqual([
      '  Admin   a@example.com       secret-one',
      '  Editor  writer@example.com  secret-two',
    ])
  })
})

describe('formatBanner', () => {
  const banner = formatBanner({
    name: 'Quill',
    endpoints: [{ label: 'App', url: 'http://localhost:5173' }],
    accounts: [{ role: 'Admin', email: 'admin@example.com', password: 'pw' }],
  })

  it('says what is running and where to open it', () => {
    expect(banner).toContain('Quill is running:')
    expect(banner).toContain('  App  http://localhost:5173')
  })

  it('lists the seeded accounts to sign in with, under their own heading', () => {
    const lines = banner.split('\n')

    expect(lines[lines.indexOf('Sign in with:') + 1]).toBe('  Admin  admin@example.com  pw')
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
