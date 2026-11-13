import { describe, expect, it } from 'vitest'

import type { CodeFileV1 } from './artifact.ts'
import { cacheKey, digest, effectiveSignatures, plan } from './cache.ts'

const file = (
  path: string,
  blob: string,
  signature: string,
  imports: string[] = [],
  reexports: string[] = [],
): CodeFileV1 => ({
  path,
  blob,
  symbols: [],
  usages: [],
  imports,
  reexports,
  signature,
})

describe('cache', () => {
  it('changes the key when any input changes', () => {
    const base = { tool: '1', compiler: '7', tsconfig: 'x', formatVersion: 1, scope: 's' }

    expect(cacheKey(base)).toBe(cacheKey({ ...base }))
    expect(cacheKey({ ...base, tool: '2' })).not.toBe(cacheKey(base))
    expect(cacheKey({ ...base, formatVersion: 2 })).not.toBe(cacheKey(base))
  })

  it('digests with sixteen hex characters', () => {
    expect(digest('same')).toBe(digest('same'))
    expect(digest('same')).not.toBe(digest('other'))
    expect(digest('same')).toMatch(/^[\da-f]{16}$/)
  })

  it('marks new and changed files stale and leaves unchanged files reused', () => {
    const previous = { a: file('a', 'one', 'sa') }
    const blobs = new Map([
      ['a', 'one'],
      ['b', 'two'],
    ])
    const result = plan(previous, blobs)

    expect([...result.stale]).toEqual([['b', 'new']])
    expect(result.reused).toEqual(['a'])
  })

  it('re-extracts an importer when its dependency signature moves', () => {
    const previous = {
      a: file('a', 'one', 'sa'),
      b: file('b', 'two', 'sb', ['a']),
    }
    const blobs = new Map([
      ['a', 'one-changed'],
      ['b', 'two'],
    ])
    const result = plan(previous, blobs, new Set(['a']), () => true)

    expect(result.stale.get('a')).toBe('changed')
    expect(result.stale.get('b')).toBe('dependency')
  })

  it('does not re-extract an importer whose record does not depend on signatures', () => {
    const previous = {
      a: file('a', 'one', 'sa'),
      b: file('b', 'two', 'sb', ['a']),
    }
    const blobs = new Map([
      ['a', 'one-changed'],
      ['b', 'two'],
    ])
    const result = plan(previous, blobs, new Set(['a']), () => false)

    expect(result.stale.get('b')).toBeUndefined()
    expect(result.reused).toEqual(['b'])
  })

  it('follows a re-export when computing a file signature', () => {
    const records = {
      a: file('a', 'one', 'sa'),
      barrel: file('barrel', 'two', 'barrel', [], ['a']),
    }
    const signatures = effectiveSignatures(records)

    expect(signatures.get('barrel')).not.toBe('barrel')
    expect(signatures.get('barrel')).toBe(digest(['barrel', signatures.get('a')].join('|')))
  })
})
