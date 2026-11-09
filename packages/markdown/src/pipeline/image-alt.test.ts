import { describe, expect, it } from 'vitest'
import type { Image } from 'mdast'

import { renderHtml } from '../render/html.ts'
import { parseMarkdown } from './processor.ts'

function imageOf(markdown: string): Image | undefined {
  const [paragraph] = parseMarkdown(markdown).children
  const [image] = paragraph?.type === 'paragraph' ? paragraph.children : []
  return image?.type === 'image' ? image : undefined
}

describe('an image’s alternative text', () => {
  it('keeps the words a directive would have taken', () => {
    expect(imageOf('![The JSON:API document](a.svg)\n')?.alt).toBe('The JSON:API document')
    expect(imageOf('![Ratio 3:2, :ok[fine]{x=1}](a.svg)\n')?.alt).toBe('Ratio 3:2, :ok[fine]{x=1}')
    expect(renderHtml(parseMarkdown('![The JSON:API document](a.svg)\n'))).toContain(
      'alt="The JSON:API document"',
    )
  })

  it('is the label’s plain text otherwise, as CommonMark reads it', () => {
    expect(imageOf('![A *very* `big` [one](x) :smile:](a.svg)\n')?.alt).toBe(
      'A very big one :smile:',
    )
    expect(imageOf('![MAIL_SENDER](a.svg)\n')?.alt).toBe('MAIL_SENDER')
  })

  it('leaves a reference image to the parser', () => {
    const [paragraph] = parseMarkdown('![JSON:API][logo]\n\n[logo]: a.svg\n').children
    const [image] = paragraph?.type === 'paragraph' ? paragraph.children : []
    expect(image?.type).toBe('imageReference')
  })
})
