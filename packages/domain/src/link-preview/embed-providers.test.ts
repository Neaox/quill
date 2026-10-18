import { describe, expect, it } from 'vitest'

import {
  EMBED_PROVIDERS,
  EMBED_RATIOS,
  createEmbedRegistry,
  unknownEmbedProviders,
} from './embed-providers.ts'

const registry = createEmbedRegistry([])
const frame = (url: string) => registry.find(new URL(url))

const VIDEO_ID = 'dQw4w9WgXcQ'
const LOOM_ID = '0123456789abcdef0123456789abcdef'
const DOC_ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789'
const SPOTIFY_ID = '4uLU6hMCjMI75M1A2tKUQC'
const NOCOOKIE = 'https://www.youtube-nocookie.com/embed'

describe('what each provider recognises, and the frame it builds', () => {
  it.each([
    [`https://www.youtube.com/watch?v=${VIDEO_ID}`, 'youtube', `${NOCOOKIE}/${VIDEO_ID}`],
    [`https://youtu.be/${VIDEO_ID}`, 'youtube', `${NOCOOKIE}/${VIDEO_ID}`],
    [`https://m.youtube.com/shorts/${VIDEO_ID}`, 'youtube', `${NOCOOKIE}/${VIDEO_ID}`],
    ['https://vimeo.com/123456789', 'vimeo', 'https://player.vimeo.com/video/123456789'],
    [
      'https://vimeo.com/123456789/abcdef0123',
      'vimeo',
      'https://player.vimeo.com/video/123456789?h=abcdef0123',
    ],
    [
      'https://player.vimeo.com/video/123456789',
      'vimeo',
      'https://player.vimeo.com/video/123456789',
    ],
    [`http://youtu.be/${VIDEO_ID}`, 'youtube', `${NOCOOKIE}/${VIDEO_ID}`],
    [`https://www.loom.com/share/${LOOM_ID}`, 'loom', `https://www.loom.com/embed/${LOOM_ID}`],
    [
      'https://www.figma.com/design/AbCdEfGhIj1234/My-file?node-id=1-2',
      'figma',
      'https://www.figma.com/embed?embed_host=embed&url=https%3A%2F%2Fwww.figma.com%2Fdesign%2FAbCdEfGhIj1234',
    ],
    [
      `https://docs.google.com/document/d/${DOC_ID}/edit`,
      'google-docs',
      `https://docs.google.com/document/d/${DOC_ID}/preview`,
    ],
    [
      'https://docs.google.com/document/d/e/2PACX-1vAbC_dEf/pub',
      'google-docs',
      'https://docs.google.com/document/d/e/2PACX-1vAbC_dEf/pub?embedded=true',
    ],
    [
      `https://docs.google.com/presentation/d/${DOC_ID}/edit`,
      'google-slides',
      `https://docs.google.com/presentation/d/${DOC_ID}/embed`,
    ],
    [
      'https://docs.google.com/presentation/d/e/2PACX-1vAbC_dEf/pub',
      'google-slides',
      'https://docs.google.com/presentation/d/e/2PACX-1vAbC_dEf/embed',
    ],
    [
      'https://docs.google.com/spreadsheets/d/e/2PACX-1vAbC_dEf/pubhtml',
      'google-sheets',
      'https://docs.google.com/spreadsheets/d/e/2PACX-1vAbC_dEf/pubhtml?widget=true&headers=false',
    ],
    [
      `https://docs.google.com/spreadsheets/d/${DOC_ID}/edit#gid=0`,
      'google-sheets',
      `https://docs.google.com/spreadsheets/d/${DOC_ID}/preview`,
    ],
    [
      `https://drive.google.com/file/d/${DOC_ID}/view`,
      'google-drive',
      `https://drive.google.com/file/d/${DOC_ID}/preview`,
    ],
    [
      `https://drive.google.com/drive/folders/${DOC_ID}`,
      'google-drive',
      `https://drive.google.com/embeddedfolderview?id=${DOC_ID}#list`,
    ],
    [
      'https://miro.com/app/board/uXjVAbCdEf0=/',
      'miro',
      'https://miro.com/app/live-embed/uXjVAbCdEf0=/',
    ],
    [
      `https://open.spotify.com/track/${SPOTIFY_ID}?si=abc`,
      'spotify',
      `https://open.spotify.com/embed/track/${SPOTIFY_ID}`,
    ],
    [
      `https://open.spotify.com/intl-fr/album/${SPOTIFY_ID}`,
      'spotify',
      `https://open.spotify.com/embed/album/${SPOTIFY_ID}`,
    ],
    [
      'https://www.linkedin.com/feed/update/urn:li:activity:7123456789012345678',
      'linkedin',
      'https://www.linkedin.com/embed/feed/update/urn:li:activity:7123456789012345678',
    ],
    [
      'https://www.linkedin.com/posts/someone_a-title-activity-7123456789012345678-AbCd',
      'linkedin',
      'https://www.linkedin.com/embed/feed/update/urn:li:activity:7123456789012345678',
    ],
  ])('%s', (url, provider, src) => {
    const found = frame(url)
    expect(found?.provider.id).toBe(provider)
    expect(found?.frame.src).toBe(src)
  })

  it.each([
    'https://example.com/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com/watch?v=short',
    'https://www.youtube.com/watch?v=dQw4w9WgXc%22',
    'https://www.youtube.com/channel/abc',
    'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ',
    'https://evil.example/https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://vimeo.com/channels/staffpicks',
    'https://www.loom.com/share/not-hex',
    'https://www.figma.com/community/file/1',
    'https://docs.google.com/forms/d/abc/edit',
    'https://docs.google.com/document/d/x/edit',
    'https://open.spotify.com/user/abc',
    'https://x.com/someone/status/1234567890',
    'https://www.linkedin.com/posts/someone_a-title-activity-short-AbCd',
    'https://www.linkedin.com/posts/someone_a-title-without-a-post',
    'https://www.linkedin.com/feed/update/urn:li:activity:%E0%A4%A',
    'https://ftp.example/anything',
    `ftp://youtu.be/${VIDEO_ID}`,
    `https://youtu.be/${VIDEO_ID}/more`,
    'https://www.youtube.com/watch',
    'https://player.vimeo.com/channels/staffpicks',
    'https://vimeo.com/123456789/abcdef0123/more',
    'https://vimeo.com/123456789/not-a-hash',
    'https://docs.google.com/document/d/e',
    `https://drive.google.com/file/d/short/view`,
    'https://drive.google.com/drive/folders/short',
    'https://www.linkedin.com/feed/update/urn:li:person:7123456789012345678',
    'https://www.linkedin.com/feed/update/urn:xx:activity:7123456789012345678',
  ])('does not embed %s', (url) => {
    expect(frame(url)).toBeNull()
  })

  it('never builds a frame address from anything but validated parts', () => {
    const hostile = new URL(
      `https://www.youtube.com/watch?v=${VIDEO_ID}&x=%22%3E%3Cscript%3E&redirect=https://evil.example`,
    )
    expect(registry.find(hostile)?.frame.src).toBe(`${NOCOOKIE}/${VIDEO_ID}`)
  })

  it('answers quickly for a long hostile path', () => {
    const path = `${'/'.repeat(5000)}${'-'.repeat(5000)}`
    const started = performance.now()
    for (const provider of EMBED_PROVIDERS) {
      const [host] = provider.hosts
      if (host === undefined) throw new Error(`${provider.id} has no hosts`)
      provider.frameFor(new URL(`https://${host}${path}`))
    }
    expect(performance.now() - started).toBeLessThan(250)
  })
})

describe('the registry as a whole', () => {
  it('has a unique id and a name for every provider', () => {
    const ids = EMBED_PROVIDERS.map((provider) => provider.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const provider of EMBED_PROVIDERS) expect(provider.name).not.toBe('')
  })

  it('frames only https origins, written as origins', () => {
    for (const provider of EMBED_PROVIDERS) {
      expect(provider.frameOrigins.length).toBeGreaterThan(0)
      for (const origin of provider.frameOrigins) {
        const parsed = new URL(origin)
        expect(parsed.protocol).toBe('https:')
        expect(parsed.origin).toBe(origin)
      }
    }
  })

  it('builds every frame inside its own origins and one of the known ratios', () => {
    const samples = [
      `https://www.youtube.com/watch?v=${VIDEO_ID}`,
      'https://vimeo.com/123456789',
      `https://www.loom.com/share/${LOOM_ID}`,
      'https://www.figma.com/design/AbCdEfGhIj1234/x',
      `https://docs.google.com/document/d/${DOC_ID}/edit`,
      `https://docs.google.com/presentation/d/${DOC_ID}/edit`,
      `https://docs.google.com/spreadsheets/d/${DOC_ID}/edit`,
      `https://drive.google.com/file/d/${DOC_ID}/view`,
      'https://miro.com/app/board/uXjVAbCdEf0=/',
      `https://open.spotify.com/track/${SPOTIFY_ID}`,
      'https://www.linkedin.com/feed/update/urn:li:share:7123456789012345678',
    ]
    for (const sample of samples) {
      const found = registry.find(new URL(sample))
      if (found === null) throw new Error(`no provider for ${sample}`)
      expect(found.provider.frameOrigins).toContain(new URL(found.frame.src).origin)
      expect(Object.values(EMBED_RATIOS)).toContain(found.frame.aspectRatio)
    }
  })

  it('states a reason wherever allow-same-origin is asked for, and grants nothing risky', () => {
    for (const provider of EMBED_PROVIDERS) {
      const sameOrigin = provider.sandbox.includes('allow-same-origin')
      expect(provider.sameOriginReason !== null).toBe(sameOrigin)
      expect(!sameOrigin || (provider.sameOriginReason?.length ?? 0) > 40).toBe(true)
      expect(provider.sandbox).toContain('allow-scripts')
      for (const token of provider.sandbox) {
        expect(token).not.toMatch(/top-navigation|modals|forms|downloads|popups/u)
      }
    }
  })

  it('leaves out a provider an operator has disabled', () => {
    const without = createEmbedRegistry(['youtube'])
    expect(without.find(new URL(`https://youtu.be/${VIDEO_ID}`))).toBeNull()
    expect(without.find(new URL('https://vimeo.com/123456789'))).not.toBeNull()
    expect(without.frameSources()).not.toContain('https://www.youtube-nocookie.com')
    expect(without.frameSources()).toContain('https://player.vimeo.com')
  })

  it('lists no frame source at all when everything is disabled', () => {
    const none = createEmbedRegistry(EMBED_PROVIDERS.map((provider) => provider.id))
    expect(none.frameSources()).toEqual([])
    expect(none.providers).toEqual([])
  })

  it('lists each origin once, however many providers share it', () => {
    const sources = registry.frameSources()
    expect(new Set(sources).size).toBe(sources.length)
    expect(sources.filter((source) => source === 'https://docs.google.com')).toHaveLength(1)
  })

  it('names ids that are not providers, so a typo in configuration is caught', () => {
    expect(unknownEmbedProviders(['youtube', 'youtbe', 'x'])).toEqual(['youtbe', 'x'])
  })

  it('does not embed X, whose post embed needs its own script', () => {
    expect(EMBED_PROVIDERS.map((provider) => provider.id)).not.toContain('x')
  })
})

describe('recognising a stored embed again at render time', () => {
  const stored = {
    provider: 'youtube',
    src: `${NOCOOKIE}/${VIDEO_ID}`,
    aspectRatio: EMBED_RATIOS['16:9'],
  }

  it('accepts what the registry itself would have built', () => {
    expect(registry.recognise(stored)?.id).toBe('youtube')
  })

  it.each([
    ['another origin', { ...stored, src: 'https://evil.example/embed/x' }],
    ['a script URL', { ...stored, src: 'javascript:alert(1)' }],
    ['an unknown provider', { ...stored, provider: 'nope' }],
    ['plain http', { ...stored, src: `http://www.youtube-nocookie.com/embed/${VIDEO_ID}` }],
    ['credentials', { ...stored, src: 'https://www.youtube-nocookie.com@evil.example/embed/x' }],
    ['an absurd ratio', { ...stored, aspectRatio: 1000 }],
    ['not a number', { ...stored, aspectRatio: Number.NaN }],
    ['not a URL', { ...stored, src: 'nonsense' }],
  ])('refuses %s', (_name, embed) => {
    expect(registry.recognise(embed)).toBeNull()
  })

  it('refuses an embed of a provider that has since been disabled', () => {
    expect(createEmbedRegistry(['youtube']).recognise(stored)).toBeNull()
  })
})
