import { describe, expect, it } from 'vitest'

import {
  DEFAULT_LINK_PREVIEW_POLICY,
  MAX_POLICY_PATTERNS,
  compileLinkPolicy,
  describePatternError,
  parseUrlPattern,
} from './link-policy.ts'
import type { LinkPreviewPolicy } from './link-policy.ts'

function policy(overrides: Partial<LinkPreviewPolicy> = {}) {
  const compiled = compileLinkPolicy({ ...DEFAULT_LINK_PREVIEW_POLICY, ...overrides })
  if (!compiled.ok) throw new Error(`policy did not compile: ${JSON.stringify(compiled.error)}`)
  return compiled.value
}

const permits = (compiled: ReturnType<typeof policy>, url: string) => compiled.permits(new URL(url))

describe('parseUrlPattern', () => {
  it('reads a host, a wildcard host, and a path prefix', () => {
    expect(parseUrlPattern('Example.COM')).toEqual({
      ok: true,
      value: { host: 'example.com', subdomainsOnly: false, pathPrefix: '' },
    })
    expect(parseUrlPattern('*.example.com')).toEqual({
      ok: true,
      value: { host: 'example.com', subdomainsOnly: true, pathPrefix: '' },
    })
    expect(parseUrlPattern('example.com/docs')).toEqual({
      ok: true,
      value: { host: 'example.com', subdomainsOnly: false, pathPrefix: '/docs' },
    })
  })

  it('treats a trailing star or slash on a path as the same prefix', () => {
    for (const written of [
      'example.com/docs',
      'example.com/docs/',
      'example.com/docs/*',
      'example.com/docs*',
    ]) {
      expect(parseUrlPattern(written)).toMatchObject({ ok: true, value: { pathPrefix: '/docs' } })
    }
    expect(parseUrlPattern('example.com/*')).toMatchObject({ ok: true, value: { pathPrefix: '' } })
  })

  it('ignores a scheme, a trailing dot and surrounding space', () => {
    expect(parseUrlPattern(' https://example.com. ')).toMatchObject({
      ok: true,
      value: { host: 'example.com' },
    })
    expect(parseUrlPattern('http://example.com')).toMatchObject({
      ok: true,
      value: { host: 'example.com' },
    })
  })

  it('converts an internationalised host to the form a request will have', () => {
    expect(parseUrlPattern('münchen.de')).toMatchObject({
      ok: true,
      value: { host: 'xn--mnchen-3ya.de' },
    })
  })

  it('writes an IPv4 literal in the normal form however it was typed', () => {
    expect(parseUrlPattern('0x7f.1')).toMatchObject({ ok: true, value: { host: '127.0.0.1' } })
  })

  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['https://', 'empty'],
    ['a'.repeat(301), 'too_long'],
    ['ex ample.com', 'invalid_host'],
    ['example.com:8443', 'invalid_host'],
    ['user@example.com', 'invalid_host'],
    ['*', 'invalid_host'],
    ['*.', 'invalid_host'],
    ['exa*mple.com', 'invalid_host'],
    ['*example.com', 'invalid_host'],
    ['999.1.1.1', 'invalid_host'],
    ['**.example.com', 'invalid_host'],
    ['example.com/a*b', 'invalid_path'],
    ['example.com/docs/**', 'invalid_path'],
    ['example.com/a?x=1', 'invalid_path'],
    ['example.com/a#frag', 'invalid_path'],
  ])('refuses "%s" as %s', (raw, error) => {
    expect(parseUrlPattern(raw)).toEqual({ ok: false, error })
  })
})

describe('compileLinkPolicy: what is permitted', () => {
  it('permits everything under the default policy', () => {
    expect(permits(policy(), 'https://anything.example/a')).toBe(true)
  })

  it('permits nothing when previews are off', () => {
    expect(permits(policy({ mode: 'off' }), 'https://example.com/')).toBe(false)
    expect(permits(policy({ mode: 'off', allow: ['example.com'] }), 'https://example.com/')).toBe(
      false,
    )
  })

  it('refuses a blocked host, and its subdomains only if they are blocked too', () => {
    const blocked = policy({ block: ['example.com', '*.tracker.net'] })
    expect(permits(blocked, 'https://example.com/a')).toBe(false)
    expect(permits(blocked, 'https://www.example.com/a')).toBe(true)
    expect(permits(blocked, 'https://a.b.tracker.net/')).toBe(false)
    expect(permits(blocked, 'https://tracker.net/')).toBe(true)
  })

  it('permits only listed hosts when there is an allow list', () => {
    const allowOnly = policy({ allow: ['docs.example.com', '*.wiki.example.com'] })
    expect(permits(allowOnly, 'https://docs.example.com/x')).toBe(true)
    expect(permits(allowOnly, 'https://team.wiki.example.com/x')).toBe(true)
    expect(permits(allowOnly, 'https://example.com/x')).toBe(false)
    expect(permits(allowOnly, 'https://evil.example/')).toBe(false)
  })

  it('lets a block win over an allow', () => {
    const both = policy({ allow: ['*.example.com'], block: ['secret.example.com'] })
    expect(permits(both, 'https://docs.example.com/')).toBe(true)
    expect(permits(both, 'https://secret.example.com/')).toBe(false)
  })

  it('matches a path prefix on a segment boundary, not as a string prefix', () => {
    const blocked = policy({ block: ['example.com/private'] })
    expect(permits(blocked, 'https://example.com/private')).toBe(false)
    expect(permits(blocked, 'https://example.com/private/')).toBe(false)
    expect(permits(blocked, 'https://example.com/private/a/b')).toBe(false)
    expect(permits(blocked, 'https://example.com/privately')).toBe(true)
    expect(permits(blocked, 'https://example.com/public')).toBe(true)
  })

  it('ignores the query and the fragment when matching a path', () => {
    const blocked = policy({ block: ['example.com/private'] })
    expect(permits(blocked, 'https://example.com/private?x=1#y')).toBe(false)
  })

  it('treats a path as case-sensitive and a host as case-insensitive', () => {
    const blocked = policy({ block: ['EXAMPLE.com/Private'] })
    expect(permits(blocked, 'https://example.COM/Private')).toBe(false)
    expect(permits(blocked, 'https://example.com/private')).toBe(true)
  })
})

describe('compileLinkPolicy: ways round a block list', () => {
  const blocked = policy({ block: ['evil.example', '127.0.0.1', 'example.com/admin'] })

  it.each([
    ['a trailing dot', 'https://evil.example./'],
    ['upper case', 'https://EVIL.Example/'],
    ['an explicit default port', 'https://evil.example:443/'],
    ['credentials in the URL', 'https://user:pw@evil.example/'],
    ['a decimal IP', 'http://2130706433/'],
    ['a hex IP', 'http://0x7f.0.0.1/'],
    ['an octal IP', 'http://0177.0.0.1/'],
    ['dot segments in the path', 'https://example.com/public/../admin/users'],
    ['an encoded dot segment', 'https://example.com/public/%2e%2e/admin'],
    ['a doubled slash is not a different path', 'https://example.com/admin//x'],
  ])('still refuses %s', (_name, url) => {
    expect(permits(blocked, url)).toBe(false)
  })
})

describe('compileLinkPolicy: images and validation', () => {
  it('allows images only in rich mode', () => {
    expect(policy({ mode: 'rich' }).images).toBe(true)
    expect(policy({ mode: 'text' }).images).toBe(false)
    expect(policy({ mode: 'off' }).images).toBe(false)
  })

  it('permits pages in text mode, since the words are the point of it', () => {
    expect(permits(policy({ mode: 'text' }), 'https://example.com/')).toBe(true)
  })

  it('refuses the whole policy for one bad pattern, naming it', () => {
    expect(
      compileLinkPolicy({ mode: 'rich', allow: [], block: ['fine.example', 'not a host'] }),
    ).toEqual({
      ok: false,
      error: { kind: 'pattern', list: 'block', pattern: 'not a host', error: 'invalid_host' },
    })
    expect(compileLinkPolicy({ mode: 'rich', allow: ['bad path/a*b'], block: [] })).toMatchObject({
      ok: false,
      error: { list: 'allow' },
    })
  })

  it('refuses a list longer than the limit', () => {
    const many = Array.from({ length: MAX_POLICY_PATTERNS + 1 }, (_, index) => `h${index}.example`)
    expect(compileLinkPolicy({ mode: 'rich', allow: [], block: many })).toEqual({
      ok: false,
      error: { kind: 'too_many', list: 'block' },
    })
    expect(compileLinkPolicy({ mode: 'rich', allow: many, block: [] })).toEqual({
      ok: false,
      error: { kind: 'too_many', list: 'allow' },
    })
  })

  it('accepts a list at exactly the limit', () => {
    const many = Array.from({ length: MAX_POLICY_PATTERNS }, (_, index) => `h${index}.example`)
    expect(compileLinkPolicy({ mode: 'rich', allow: many, block: [] }).ok).toBe(true)
  })
})

describe('describing a pattern that was refused', () => {
  it('says why in words an administrator can act on, for every reason', () => {
    const reasons = ['empty', 'too_long', 'invalid_host', 'invalid_path'] as const
    const messages = reasons.map(describePatternError)
    expect(new Set(messages).size).toBe(reasons.length)
    for (const message of messages) expect(message).toMatch(/^[A-Z].*\.$/u)
    expect(describePatternError('invalid_host')).toMatch(/host/u)
    expect(describePatternError('invalid_path')).toMatch(/path/u)
  })

  it('agrees with the parser about what is refused', () => {
    const refused = ['', 'not a host', 'example.com:8080', 'a.com/x*y'].map(parseUrlPattern)
    expect(refused.every((parsed) => !parsed.ok)).toBe(true)
    const reasons = refused.flatMap((parsed) => (parsed.ok ? [] : [parsed.error]))
    expect(reasons).toHaveLength(4)
    for (const reason of reasons) expect(describePatternError(reason).length).toBeGreaterThan(10)
  })
})
