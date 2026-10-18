import { describe, expect, it } from 'vitest'

import { OEMBED_PROVIDERS } from './oembed-providers.gen.ts'
import { createOembedRegistry } from './oembed-registry.ts'

const registry = createOembedRegistry([
  {
    name: 'YouTube',
    endpoint: 'https://www.youtube.com/oembed',
    schemes: ['https://*.youtube.com/watch*', 'https://youtu.be/*'],
  },
  {
    name: 'Example Slides',
    endpoint: 'https://slides.example/api/oembed?theme=dark',
    schemes: ['http://slides.example/decks/*'],
  },
  { name: 'Bare', endpoint: 'https://bare.example/oembed', schemes: ['https://bare.example'] },
  {
    name: 'Broken',
    endpoint: 'https://broken.example/oembed',
    schemes: ['ftp://broken.example/*'],
  },
])

describe('createOembedRegistry', () => {
  it('matches a URL against a provider scheme and builds the endpoint request', () => {
    const match = registry.find(new URL('https://www.youtube.com/watch?v=abc123'))
    expect(match?.provider).toBe('YouTube')
    const endpoint = new URL(match?.endpointUrl ?? '')
    expect(endpoint.origin + endpoint.pathname).toBe('https://www.youtube.com/oembed')
    expect(endpoint.searchParams.get('url')).toBe('https://www.youtube.com/watch?v=abc123')
    expect(endpoint.searchParams.get('format')).toBe('json')
  })

  it('lets a trailing wildcard match nothing at all', () => {
    expect(registry.find(new URL('https://www.youtube.com/watch'))?.provider).toBe('YouTube')
  })

  it('matches the short-link form', () => {
    expect(registry.find(new URL('https://youtu.be/abc123'))?.provider).toBe('YouTube')
  })

  it('matches either scheme, whichever the registry listed', () => {
    expect(registry.find(new URL('https://slides.example/decks/42'))?.provider).toBe(
      'Example Slides',
    )
  })

  it('keeps parameters the endpoint already carries', () => {
    const match = registry.find(new URL('https://slides.example/decks/42'))
    expect(new URL(match?.endpointUrl ?? '').searchParams.get('theme')).toBe('dark')
  })

  it('does not match a host wildcard across a slash, so a path cannot pose as a subdomain', () => {
    expect(registry.find(new URL('https://evil.example/x.youtube.com/watch'))).toBeNull()
    expect(registry.find(new URL('https://evil.example/.youtube.com/watch?v=1'))).toBeNull()
  })

  it('does not match a look-alike host', () => {
    expect(registry.find(new URL('https://notyoutube.com/watch?v=1'))).toBeNull()
    expect(registry.find(new URL('https://youtube.com.evil.example/watch?v=1'))).toBeNull()
  })

  it('treats regular-expression characters in a scheme as literal', () => {
    expect(registry.find(new URL('https://slidesXexample/decks/1'))).toBeNull()
  })

  it('answers null for a URL no provider claims, and ignores an unusable scheme', () => {
    expect(registry.find(new URL('https://example.com/post'))).toBeNull()
    expect(registry.find(new URL('ftp://broken.example/x'))).toBeNull()
  })

  it('does not backtrack on a path built to defeat a many-wildcard pattern', () => {
    const real = createOembedRegistry(OEMBED_PROVIDERS)
    const started = performance.now()
    // A shorter Backtracks scheme may legitimately match; the point is how long deciding takes.
    real.find(new URL(`https://backtracks.fm/${'a/'.repeat(1500)}`))
    real.find(new URL(`https://backtracks.fm/${'a/'.repeat(1500)}e/x`))
    // A generous bound: the attack it guards against takes tens of seconds, and a busy machine takes one.
    expect(performance.now() - started).toBeLessThan(3000)
  })

  it('does not look up a URL longer than any real link', () => {
    expect(registry.find(new URL(`https://youtu.be/${'a'.repeat(5000)}`))).toBeNull()
  })

  it('matches a wildcard that spans several path segments, and one that matches nothing', () => {
    const slides = createOembedRegistry([
      {
        name: 'Deep',
        endpoint: 'https://deep.example/oembed',
        schemes: ['https://deep.example/*/x/*/y'],
      },
    ])
    expect(slides.find(new URL('https://deep.example/a/b/x/c/d/y'))?.provider).toBe('Deep')
    expect(slides.find(new URL('https://deep.example//x//y'))?.provider).toBe('Deep')
    expect(slides.find(new URL('https://deep.example/a/x/c/z'))).toBeNull()
  })

  it('matches a scheme that names no path only against a URL with no path to speak of', () => {
    expect(registry.find(new URL('https://bare.example/'))).toBeNull()
    expect(registry.find(new URL('https://bare.example/x'))).toBeNull()
  })

  it('ignores the fragment', () => {
    expect(registry.find(new URL('https://youtu.be/abc#t=10'))?.provider).toBe('YouTube')
  })
})

describe('the vendored registry', () => {
  const real = createOembedRegistry(OEMBED_PROVIDERS)

  it('is not empty, and every endpoint is https', () => {
    expect(OEMBED_PROVIDERS.length).toBeGreaterThan(100)
    expect(OEMBED_PROVIDERS.every((provider) => provider.endpoint.startsWith('https://'))).toBe(
      true,
    )
  })

  it('knows the providers people paste most', () => {
    expect(real.find(new URL('https://www.youtube.com/watch?v=dQw4w9WgXcQ'))?.provider).toBe(
      'YouTube',
    )
    expect(real.find(new URL('https://vimeo.com/76979871'))?.provider).toBe('Vimeo')
  })

  it('compiles every scheme without throwing, and stays fast for a miss', () => {
    const started = performance.now()
    for (let index = 0; index < 1000; index += 1) {
      real.find(new URL(`https://unknown-${index}.example/some/path?x=${index}`))
    }
    // A generous bound: the attack it guards against takes tens of seconds, and a busy machine takes one.
    expect(performance.now() - started).toBeLessThan(5000)
  })
})
