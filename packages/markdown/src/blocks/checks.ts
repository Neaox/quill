import { BRAND } from '@quill/brand'

import { defineBlock, h } from './define.ts'
import { linesOf } from './phrasing.ts'

/**
 * Checks made in order, drawn as numbered chips that wrap:
 *
 * ```markdown
 * :::checks
 * 1. The request is well formed
 * 2. The reader belongs to the branch
 * :::
 * ```
 *
 * It stays an ordered list, so it is announced as one and numbered without
 * styles; the numbers are the list's own, counted from one whatever
 * number the list starts at. Outside Quill it is the numbered list it is written as.
 */
export const checksBlock = defineBlock({
  id: `${BRAND.slug}.checks`,
  version: '1.0.0',
  name: 'checks',
  title: 'Checks',
  description: 'Checks made in order: a numbered list, one line each, drawn as numbered chips.',
  content: 'blocks',
  props: {},
  render: ({ children, draw }) =>
    h(
      'ol',
      {},
      linesOf(children, 'numbers', 'checks', 'a numbered list, one check a line').map((line) =>
        h('li', {}, draw(line)),
      ),
    ),
})
