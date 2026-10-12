import type { CustomEmoji } from '@quill/markdown'
import { describe, expect, it } from 'vitest'

import { emojiCatalogue } from './emoji-catalogue.ts'

const ACME: CustomEmoji = {
  src: '/api/emoji/acme.0123456789abcdef.svg',
  description: 'Acme’s roadrunner logo',
  width: 64,
  height: 64,
}
const GLOBEX: CustomEmoji = {
  src: '/api/emoji/globex_logo.fedcba9876543210.png',
  width: 128,
  height: 64,
}

const entry = (catalogue: Awaited<ReturnType<typeof emojiCatalogue>>, name: string) =>
  catalogue.find((candidate) => candidate.name === name)

describe('the emoji an author can choose from', () => {
  it('lists the organisation’s own first, by their picture and what it shows', async () => {
    const catalogue = await emojiCatalogue(new Map([['acme', ACME]]))

    expect(catalogue[0]).toEqual({
      name: 'acme',
      names: ['acme'],
      description: 'Acme’s roadrunner logo',
      image: ACME.src,
    })
  })

  it('says an undescribed custom emoji as its name in words, as the reader is told it', async () => {
    const catalogue = await emojiCatalogue(new Map([['globex_logo', GLOBEX]]))

    expect(entry(catalogue, 'globex_logo')?.description).toBe('globex logo')
  })

  it('then GitHub’s, each by its character, its description and every name it answers to', async () => {
    const catalogue = await emojiCatalogue(new Map())

    expect(entry(catalogue, 'tada')).toMatchObject({
      glyph: '🎉',
      description: 'party popper',
      names: ['tada'],
    })
    expect(entry(catalogue, '+1')).toMatchObject({ glyph: '👍' })
    expect(catalogue.length).toBeGreaterThan(1800)
  })

  it('keeps every name an emoji answers to, so any of them finds it', async () => {
    const catalogue = await emojiCatalogue(new Map())

    expect(entry(catalogue, '+1')?.names).toEqual(['+1', 'thumbsup'])
  })

  it('names a standard emoji by the first of its names, which is what is written', async () => {
    const catalogue = await emojiCatalogue(new Map())

    const thumbs = catalogue.find((candidate) => 'glyph' in candidate && candidate.glyph === '👍')

    expect(thumbs?.name).toBe(thumbs?.names[0])
  })

  it('lets a custom name shadow GitHub’s, as the renderer does, and offers the rest of that emoji', async () => {
    const catalogue = await emojiCatalogue(new Map([['thumbsup', ACME]]))

    expect(catalogue.filter((candidate) => candidate.names.includes('thumbsup'))).toHaveLength(1)
    expect(entry(catalogue, 'thumbsup')).toMatchObject({ image: ACME.src })
    expect(entry(catalogue, '+1')).toMatchObject({ names: ['+1'], glyph: '👍' })
  })

  it('leaves out a standard emoji whose every name a custom emoji has taken', async () => {
    const catalogue = await emojiCatalogue(new Map([['tada', ACME]]))

    expect(catalogue.filter((candidate) => candidate.names.includes('tada'))).toHaveLength(1)
    expect(catalogue.some((candidate) => 'glyph' in candidate && candidate.glyph === '🎉')).toBe(
      false,
    )
  })

  it('leaves out a custom emoji whose picture this server does not serve, as the renderer does', async () => {
    const catalogue = await emojiCatalogue(
      new Map([['evil', { ...ACME, src: 'https://x.test/a.png' }]]),
    )

    expect(entry(catalogue, 'evil')).toBeUndefined()
  })
})
