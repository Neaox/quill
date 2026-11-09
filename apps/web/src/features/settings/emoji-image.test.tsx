import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { EmojiImage } from './emoji-image.tsx'

describe('EmojiImage, a monochrome emoji before it is saved', () => {
  it('draws only a glyph’s own shapes and paint from what the upload answered', () => {
    const hostile = [
      '<svg xmlns="http://www.w3.org/2000/svg"><symbol id="glyph">',
      '<g fill="currentColor" onclick="alert(1)" style="fill:red" class="x">',
      '<path d="M1 1" stroke-width="2"/><script>alert(1)</script>',
      '<foreignObject><div>x</div></foreignObject><image href="https://evil.example/x.png"/>',
      '</g></symbol></svg>',
    ].join('')
    const { container } = render(
      <EmojiImage
        className="mark"
        alt=""
        image={{ src: 'blob:preview', glyph: { width: 16, height: 16, markup: hostile } }}
      />,
    )
    expect(container.innerHTML).toBe(
      '<svg class="mark" viewBox="0 0 16 16" aria-hidden="true"><g fill="currentColor"><path d="M1 1" stroke-width="2"></path></g></svg>',
    )
  })

  it('draws nothing from markup that holds no glyph', () => {
    const { container } = render(
      <EmojiImage
        className="mark"
        alt="Clock"
        image={{
          src: 'blob:preview',
          glyph: { width: 16, height: 16, markup: '<p>not a glyph</p>' },
        }}
      />,
    )
    expect(container.querySelector('svg')?.children).toHaveLength(0)
  })
})
