import { describe, expect, it } from 'vitest'

import { normaliseUrl } from './normalise-url.ts'

describe('normaliseUrl', () => {
  it('lower-cases the scheme and host, and drops the default port', () => {
    expect(normaliseUrl('HTTPS://Example.COM:443/Path')).toBe('https://example.com/Path')
    expect(normaliseUrl('http://example.com:80/')).toBe('http://example.com/')
  })

  it('keeps a port that is not the default', () => {
    expect(normaliseUrl('https://example.com:8443/')).toBe('https://example.com:8443/')
  })

  it('adds the root path to a bare origin', () => {
    expect(normaliseUrl('https://example.com')).toBe('https://example.com/')
  })

  it('removes the fragment', () => {
    expect(normaliseUrl('https://example.com/a#section-2')).toBe('https://example.com/a')
  })

  it('keeps a line-range fragment, because it selects what the link is about', () => {
    expect(normaliseUrl('https://github.com/o/r/blob/abc/a.ts#L10-L20')).toBe(
      'https://github.com/o/r/blob/abc/a.ts#L10-L20',
    )
    expect(normaliseUrl('https://github.com/o/r/blob/abc/a.ts#L7')).toBe(
      'https://github.com/o/r/blob/abc/a.ts#L7',
    )
  })

  it.each(['#L', '#L10-', '#Lx', '#l10', '#L10-L20-L30', '#L10-20x', '#section'])(
    'still removes %s, which is not a line range',
    (fragment) => {
      expect(normaliseUrl(`https://example.com/a${fragment}`)).toBe('https://example.com/a')
    },
  )

  it('removes tracking parameters, by name and by prefix, in any case', () => {
    expect(
      normaliseUrl(
        'https://example.com/a?utm_source=x&id=7&gclid=1&FBCLID=2&mc_cid=3&UTM_Medium=m',
      ),
    ).toBe('https://example.com/a?id=7')
  })

  it('drops the question mark when nothing is left', () => {
    expect(normaliseUrl('https://example.com/a?utm_source=x')).toBe('https://example.com/a')
  })

  it('sorts the remaining parameters, keeping repeated names in order', () => {
    expect(normaliseUrl('https://example.com/?b=2&a=2&a=1')).toBe(
      'https://example.com/?a=2&a=1&b=2',
    )
  })

  it('treats two spellings of one page as one key', () => {
    expect(normaliseUrl('https://Example.com/p?b=1&a=2&utm_campaign=z#top')).toBe(
      normaliseUrl('https://example.com:443/p?a=2&b=1'),
    )
  })

  it('does not guess about the path: a trailing slash and case are kept', () => {
    expect(normaliseUrl('https://example.com/Docs/')).not.toBe(
      normaliseUrl('https://example.com/docs'),
    )
    expect(normaliseUrl('https://example.com/docs/')).not.toBe(
      normaliseUrl('https://example.com/docs'),
    )
  })

  it('refuses a URL longer than any real link, and keeps one at the limit', () => {
    expect(normaliseUrl(`https://example.com/${'a'.repeat(4100)}`)).toBeNull()
    expect(normaliseUrl(`https://example.com/${'a'.repeat(4000)}`)).not.toBeNull()
  })

  it('trims surrounding whitespace, as a paste carries it', () => {
    expect(normaliseUrl('  https://example.com/a \n')).toBe('https://example.com/a')
  })

  it.each([
    ['not a url'],
    [''],
    ['ftp://example.com/file'],
    ['javascript:alert(1)'],
    ['file:///etc/passwd'],
    ['mailto:a@example.com'],
    ['https://user:secret@example.com/'],
    ['https://user@example.com/'],
  ])('refuses %s', (raw) => {
    expect(normaliseUrl(raw)).toBeNull()
  })
})
