import type { Element, Root as HastRoot } from 'hast'
import { sanitize } from 'hast-util-sanitize'
import { toHtml } from 'hast-util-to-html'
import { describe, expect, it } from 'vitest'

import { sanitizeSchema } from '../render/sanitize-schema.ts'
import { EMOJI_FRAMES_ATTRIBUTE, EMOJI_LOOP_ATTRIBUTE } from './emoji.ts'

/**
 * ADR-011 and ADR-047: an animated emoji's timing reaches the reader's
 * enhancer as two data attributes on its `picture`. The sanitiser admits
 * them only as integers within the upload limits, so nothing else rides on
 * them into a script that reads them.
 */
function picture(properties: Element['properties']): HastRoot {
  return {
    type: 'root',
    children: [
      {
        type: 'element',
        tagName: 'picture',
        properties: { className: ['emoji'], ...properties },
        children: [],
      },
    ],
  }
}

const sanitized = (properties: Element['properties']): string =>
  toHtml(sanitize(picture(properties), sanitizeSchema))

describe('an animated emoji’s timing, past the sanitiser', () => {
  it('is admitted as bounded integers', () => {
    expect(sanitized({ [EMOJI_FRAMES_ATTRIBUTE]: '2', [EMOJI_LOOP_ATTRIBUTE]: '1' })).toBe(
      '<picture class="emoji" data-frames="2" data-loop-ms="1"></picture>',
    )
    expect(sanitized({ [EMOJI_FRAMES_ATTRIBUTE]: '300', [EMOJI_LOOP_ATTRIBUTE]: '10000' })).toBe(
      '<picture class="emoji" data-frames="300" data-loop-ms="10000"></picture>',
    )
    expect(sanitized({ [EMOJI_FRAMES_ATTRIBUTE]: '45', [EMOJI_LOOP_ATTRIBUTE]: '960' })).toBe(
      '<picture class="emoji" data-frames="45" data-loop-ms="960"></picture>',
    )
  })

  it.each([
    ['1'],
    ['301'],
    ['0'],
    ['-2'],
    ['2.5'],
    ['1e2'],
    ['007'],
    [' 12'],
    ['12 '],
    ['12" onload="alert(1)'],
    ['javascript:alert(1)'],
    ['99999999999999999999'],
  ])('drops a frame count of %j', (value) => {
    expect(sanitized({ [EMOJI_FRAMES_ATTRIBUTE]: value })).toBe('<picture class="emoji"></picture>')
  })

  it.each([['0'], ['10001'], ['-1'], ['1.5'], ['0x10'], ['Infinity'], ['NaN'], ['01000']])(
    'drops a loop length of %j',
    (value) => {
      expect(sanitized({ [EMOJI_LOOP_ATTRIBUTE]: value })).toBe('<picture class="emoji"></picture>')
    },
  )

  it('is admitted on an emoji’s picture and nowhere else', () => {
    const tree: HastRoot = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'span',
          properties: { [EMOJI_FRAMES_ATTRIBUTE]: '12', [EMOJI_LOOP_ATTRIBUTE]: '1200' },
          children: [],
        },
        {
          type: 'element',
          tagName: 'img',
          properties: { [EMOJI_FRAMES_ATTRIBUTE]: '12', [EMOJI_LOOP_ATTRIBUTE]: '1200' },
          children: [],
        },
      ],
    }
    expect(toHtml(sanitize(tree, sanitizeSchema))).toBe('<span></span><img>')
  })
})
