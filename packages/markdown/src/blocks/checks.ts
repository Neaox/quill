import { BRAND } from '@quill/brand'

import { defineBlock, h } from './define.ts'
import { linesOf } from './phrasing.ts'

/**
 * Checks made in order, drawn as numbered chips that wrap
 * (`docs/design/quill-docs.md` in lockstay):
 *
 * ```markdown
 * :::checks
 * 1. The request's format
 * 2. Ana belongs to the account
 * :::
 * ```
 *
 * It stays an ordered list, so it is announced as one and numbered without
 * styles; the numbers are the list's own, counted from one as lockstay's
 * site counts them. Outside Quill it is the numbered list it is written as.
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
