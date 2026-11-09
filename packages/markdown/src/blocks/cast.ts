import { BRAND } from '@quill/brand'
import { toString } from 'mdast-util-to-string'
import type { Element } from 'hast'
import type { PhrasingContent } from 'mdast'

import { emojiNameOf } from '../emoji/emoji.ts'
import { defineBlock, h } from './define.ts'
import {
  EMOJI_TOKEN,
  LITERAL_SHORTCODE,
  NODE_TOKEN,
  lineOf,
  linesOf,
  nodeAt,
  phrasingOf,
} from './phrasing.ts'
import { p } from './props.ts'
import { nodeElement } from './timeline.ts'

/**
 * A cast: who and what a page is about, one chip each (`docs/design/quill-docs.md`
 * in lockstay).
 *
 * ```markdown
 * :::cast{outside="Airbnb, Booking.com" narrow}
 * - :person: **Ana Silva** · Owns Kowhai Bach, a holiday home
 * - :airbnb: **Airbnb** · Tells lockstay about each booking
 * :::
 * ```
 *
 * Each member is an emoji, a name in bold and what it does. `outside` names
 * the members drawn as rings, because they are outside the system the page
 * describes; a bare `narrow` sets narrower chips, three to a row. Members are
 * read exactly as lockstay's own site reads them. Outside Quill it is the
 * list it is written as.
 */

/** A member: an emoji, its name in bold, then ` · ` and what it does. */
const MEMBER = new RegExp(
  `^(?:(?:${EMOJI_TOKEN}|${LITERAL_SHORTCODE})[ \\t]+)?${NODE_TOKEN}(?:[ \\t]+·)?[ \\t]*([\\s\\S]*)$`,
  'u',
)

const LINE_BREAK = /[ \t]*\n[ \t]*/gu

interface Member {
  readonly icon: string | undefined
  /** The name as words, which `outside` names it by. */
  readonly name: string
  readonly nameNodes: readonly PhrasingContent[]
  readonly description: readonly PhrasingContent[]
}

function memberOf(children: readonly PhrasingContent[]): Member {
  const line = lineOf(children)
  // An item wrapped over several lines is one line, as lockstay joins it.
  const text = line.text.replaceAll(LINE_BREAK, ' ').trim()
  const match = MEMBER.exec(text)
  const bold = nodeAt(line, match?.[2])
  if (match === null || bold?.type !== 'strong') {
    return { icon: undefined, name: '', nameNodes: [], description: phrasingOf(line, text) }
  }
  const lead = nodeAt(line, match[1])
  return {
    icon: lead === undefined ? undefined : emojiNameOf(lead),
    name: toString(bold),
    nameNodes: bold.children,
    description: phrasingOf(line, match[3] ?? ''),
  }
}

export const castBlock = defineBlock({
  id: `${BRAND.slug}.cast`,
  version: '1.0.0',
  name: 'cast',
  title: 'Cast',
  description:
    'Who and what a page is about, one chip each: a list of `:emoji: **Name** · what it does`.',
  content: 'blocks',
  props: {
    outside: p.list({
      title: 'Outside',
      description: 'The members drawn as rings, by name, separated by commas.',
      default: [],
    }),
    narrow: p.boolean({ title: 'Narrow', description: 'Narrower chips, three to a row.' }),
  },
  data: ['data-qb-tone'],
  render: ({ props, children, draw, emoji }) => {
    const members = linesOf(children, 'bullets', 'cast', 'a bulleted list of members').map(memberOf)
    const outside = new Set(props.outside)
    return h(
      'ul',
      { className: props.narrow ? ['qb-cast-narrow'] : [] },
      members.map((member): Element =>
        h(
          'li',
          {},
          nodeElement(
            'qb-cast-node',
            member.icon === undefined ? undefined : emoji(member.icon, 'decoration'),
            outside.has(member.name) ? 'outside' : undefined,
          ),
          h(
            'span',
            { className: ['qb-cast-text'] },
            member.nameNodes.length > 0 && h('strong', {}, draw([...member.nameNodes])),
            draw([...member.description]),
          ),
        ),
      ),
    )
  },
})
