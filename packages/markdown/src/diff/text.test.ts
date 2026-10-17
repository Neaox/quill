import type { Image, ImageReference } from 'mdast'
import { describe, expect, it } from 'vitest'

import type { DiffCode } from './nodes.ts'
import { plainText } from './text.ts'

describe('the words a node shows', () => {
  it('is the alternative text of an image, and nothing when it has none', () => {
    const described: Image = { type: 'image', url: 'a.png', alt: 'A diagram' }
    const bare: Image = { type: 'image', url: 'a.png' }
    const reference: ImageReference = {
      type: 'imageReference',
      identifier: 'a',
      referenceType: 'full',
    }
    expect(plainText(described)).toBe('A diagram')
    expect(plainText(bare)).toBe('')
    expect(plainText(reference)).toBe('')
  })

  it('is the lines of a code block with changes, whichever side each part is from', () => {
    const code: DiffCode = {
      type: 'diffCode',
      lines: [
        {
          change: 'removed',
          before: 1,
          segments: [
            { change: 'equal', text: 'port = ' },
            { change: 'removed', text: '3000' },
          ],
        },
        {
          change: 'added',
          after: 1,
          segments: [
            { change: 'equal', text: 'port = ' },
            { change: 'added', text: '3001' },
          ],
        },
      ],
    }
    expect(plainText(code)).toBe('port = 3000\nport = 3001')
  })
})
