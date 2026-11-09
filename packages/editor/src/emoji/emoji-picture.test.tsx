import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { emojiCatalogue } from './emoji-catalogue.ts'
import { EmojiPicture, emojiPictureAddress } from './emoji-picture.tsx'

describe('an emoji’s picture in a menu', () => {
  it('is an image for a picture, and a glyph in the menu’s ink for a monochrome emoji', () => {
    const picture = render(
      <EmojiPicture
        image={emojiPictureAddress('/api/emoji/acme.0123456789abcdef.png', undefined)}
        className="mark"
      />,
    )
    const image = picture.container.querySelector('img.mark')
    expect(image?.getAttribute('src')).toBe('/api/emoji/acme.0123456789abcdef.png')
    expect(image?.getAttribute('alt')).toBe('')
    const glyph = render(
      <EmojiPicture
        image={emojiPictureAddress('/api/emoji/clock.0123456789abcdef.svg', true)}
        className="mark"
      />,
    )
    const svg = glyph.container.querySelector('svg.mark')
    expect(svg?.getAttribute('aria-hidden')).toBe('true')
    expect(svg?.querySelector('use')?.getAttribute('href')).toBe(
      '/api/emoji/clock.0123456789abcdef.svg#glyph',
    )
  })

  it('is offered by the catalogue as a glyph for a monochrome emoji', async () => {
    const catalogue = await emojiCatalogue(
      new Map([
        [
          'clock',
          { src: '/api/emoji/clock.0123456789abcdef.svg', width: 16, height: 16, monochrome: true },
        ],
      ]),
    )
    expect(catalogue.find((entry) => entry.name === 'clock')).toMatchObject({
      image: '/api/emoji/clock.0123456789abcdef.svg#glyph',
    })
  })
})
