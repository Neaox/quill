import { describe, expect, it } from 'vitest'

import { DEFAULT_THEME } from '@quill/theme'

import { defaultOrganisationSettings, validateOrganisationSettings } from './documents.ts'
import { MAX_PLAYS } from '../use-cases/animation.ts'
import type { CustomEmojiEntry } from './emoji.ts'
import { customEmojiByName, emojiFileName, emojiForFile, emojiUrl, labelEmoji } from './emoji.ts'

const ACME: CustomEmojiEntry = {
  name: 'acme',
  hash: '0123456789abcdef'.repeat(4),
  mediaType: 'image/svg+xml',
  width: 64,
  height: 64,
}
const PARTY: CustomEmojiEntry = {
  name: 'party',
  hash: 'a'.repeat(64),
  mediaType: 'image/gif',
  still: 'b'.repeat(64),
  width: 32,
  height: 32,
}
const GLOBEX: CustomEmojiEntry = {
  name: 'globex_logo',
  hash: 'f'.repeat(64),
  mediaType: 'image/webp',
  width: 128,
  height: 64,
}

/** The rules an emoji list breaks, by where. */
const issues = (emoji: unknown) => {
  const result = validateOrganisationSettings({ ...defaultOrganisationSettings(), emoji })
  return result.valid ? [] : result.issues.map(({ path, rule }) => ({ path, rule }))
}

describe('custom emoji in the organisation’s settings (ADR-038)', () => {
  it('are optional, so a file written before them reads as it did', () => {
    expect(validateOrganisationSettings(defaultOrganisationSettings()).valid).toBe(true)
    expect(
      validateOrganisationSettings({ ...defaultOrganisationSettings(), emoji: [ACME, GLOBEX] })
        .valid,
    ).toBe(true)
  })

  it('may be any of the web’s images: PNG, JPEG, GIF, WebP, AVIF or SVG', () => {
    const types = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'] as const
    for (const mediaType of types) expect(issues([{ ...ACME, mediaType }])).toEqual([])
  })

  it('refuse two of one name, a malformed name, and anything that is not an image of theirs', () => {
    expect(issues([ACME, GLOBEX, ACME])).toEqual([{ path: '/emoji/2/name', rule: 'emoji-unique' }])
    expect(issues([{ ...ACME, name: 'Acme' }])).not.toEqual([])
    expect(issues([{ ...ACME, mediaType: 'image/tiff' }])).not.toEqual([])
    expect(issues([{ ...ACME, still: 'nope' }])).not.toEqual([])
    expect(issues([{ ...ACME, width: 0 }])).not.toEqual([])
    expect(issues([{ ...ACME, hash: 'nope' }])).not.toEqual([])
  })

  it('are served under their name and a hash of their bytes', () => {
    expect(emojiFileName(ACME)).toBe('acme.0123456789abcdef.svg')
    expect(emojiUrl(GLOBEX)).toBe('/api/emoji/globex_logo.ffffffffffffffff.webp')
    expect(emojiForFile([ACME, GLOBEX], 'acme.0123456789abcdef.svg')).toEqual({
      hash: ACME.hash,
      mediaType: 'image/svg+xml',
    })
    expect(emojiForFile([ACME], 'acme.ffffffffffffffff.svg')).toBeUndefined()
    expect(emojiForFile(undefined, 'acme.0123456789abcdef.svg')).toBeUndefined()
    expect(emojiUrl({ ...ACME, mediaType: 'image/jpeg' })).toMatch(/\.jpg$/u)
    expect(emojiUrl({ ...ACME, mediaType: 'image/avif' })).toMatch(/\.avif$/u)
  })

  it('serve an animation’s still beside it, as a GIF of its own hash', () => {
    expect(emojiForFile([PARTY], 'party.aaaaaaaaaaaaaaaa.gif')).toEqual({
      hash: PARTY.hash,
      mediaType: 'image/gif',
    })
    expect(emojiForFile([PARTY], 'party.bbbbbbbbbbbbbbbb.gif')).toEqual({
      hash: PARTY.still,
      mediaType: 'image/gif',
    })
    expect(customEmojiByName([PARTY]).get('party')).toEqual({
      src: '/api/emoji/party.aaaaaaaaaaaaaaaa.gif',
      still: '/api/emoji/party.bbbbbbbbbbbbbbbb.gif',
      width: 32,
      height: 32,
    })
  })

  it('record an animation’s timing and its bound, each optional, so older entries read as before (ADR-047)', () => {
    const timed = {
      ...PARTY,
      frames: 12,
      milliseconds: 1200,
      plays: 3,
      original: 'c'.repeat(64),
      poster: 4,
      stillType: 'image/png',
    }
    expect(issues([PARTY])).toEqual([])
    expect(issues([timed])).toEqual([])
    expect(issues([{ ...timed, frames: 1 }])).not.toEqual([])
    expect(issues([{ ...timed, frames: 301 }])).not.toEqual([])
    expect(issues([{ ...timed, frames: 2.5 }])).not.toEqual([])
    expect(issues([{ ...timed, milliseconds: 0 }])).not.toEqual([])
    expect(issues([{ ...timed, milliseconds: 10_001 }])).not.toEqual([])
    expect(issues([{ ...timed, plays: 0 }])).not.toEqual([])
    expect(issues([{ ...timed, plays: MAX_PLAYS + 1 }])).not.toEqual([])
    expect(issues([{ ...timed, original: 'nope' }])).not.toEqual([])
    expect(issues([{ ...timed, poster: 300 }])).not.toEqual([])
    expect(issues([{ ...timed, stillType: 'image/svg+xml' }])).not.toEqual([])
  })

  it('say what the picture shows, for a reader who cannot see it, and give it to the renderer', () => {
    const described = { ...ACME, description: 'Acme, a roadrunner logo' }

    expect(issues([described])).toEqual([])
    expect(issues([{ ...ACME, description: '' }])).not.toEqual([])
    expect(issues([{ ...ACME, description: 'x'.repeat(121) }])).not.toEqual([])
    expect(customEmojiByName([described]).get('acme')?.description).toBe('Acme, a roadrunner logo')
    expect(customEmojiByName([ACME]).get('acme')).not.toHaveProperty('description')
  })

  it('give the renderer an animation’s timing, for the reader to play it briefly by', () => {
    expect(customEmojiByName([{ ...PARTY, frames: 12, milliseconds: 1200 }]).get('party')).toEqual({
      src: '/api/emoji/party.aaaaaaaaaaaaaaaa.gif',
      still: '/api/emoji/party.bbbbbbbbbbbbbbbb.gif',
      frames: 12,
      milliseconds: 1200,
      width: 32,
      height: 32,
    })
  })

  it('serve a chosen poster frame as the PNG the browser cut it as', () => {
    const posted = { ...PARTY, stillType: 'image/png' as const, poster: 4 }
    expect(emojiForFile([posted], 'party.bbbbbbbbbbbbbbbb.png')).toEqual({
      hash: PARTY.still,
      mediaType: 'image/png',
    })
    expect(emojiForFile([posted], 'party.bbbbbbbbbbbbbbbb.gif')).toBeUndefined()
    expect(customEmojiByName([posted]).get('party')?.still).toBe(
      '/api/emoji/party.bbbbbbbbbbbbbbbb.png',
    )
    // The upload as it came is kept, and never served.
    expect(
      emojiForFile([{ ...PARTY, original: 'c'.repeat(64) }], 'party.cccccccccccccccc.gif'),
    ).toBeUndefined()
  })

  it('reach the renderer by name, ready to draw', () => {
    expect(customEmojiByName([ACME])).toEqual(
      new Map([['acme', { src: '/api/emoji/acme.0123456789abcdef.svg', width: 64, height: 64 }]]),
    )
    expect(customEmojiByName(undefined)).toEqual(new Map())
  })
})

describe('the emoji a label leads with', () => {
  const theme = {
    ...DEFAULT_THEME,
    labels: [
      { name: 'acme', title: 'Acme', hue: 15 },
      { name: 'globex', title: 'Globex', hue: 255, emoji: 'globex_logo' },
      { name: 'support', title: 'Support', hue: 95 },
    ],
  }

  it('is the one it names, or else the organisation’s own of its name', () => {
    expect(labelEmoji(theme, [ACME])).toEqual(
      new Map([
        ['acme', 'acme'],
        ['globex', 'globex_logo'],
      ]),
    )
  })

  it('is none for a theme without labels or an organisation without emoji', () => {
    expect(labelEmoji(DEFAULT_THEME, [ACME])).toEqual(new Map())
    expect(labelEmoji(theme, undefined)).toEqual(new Map([['globex', 'globex_logo']]))
  })
})
