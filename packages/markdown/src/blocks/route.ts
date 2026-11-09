import { BRAND } from '@quill/brand'
import type { Element, ElementContent } from 'hast'
import type { PhrasingContent } from 'mdast'

import { emojiNameOf } from '../emoji/emoji.ts'
import type { BlockRenderInput } from './define.ts'
import { defineBlock, h } from './define.ts'
import type { Line } from './phrasing.ts'
import {
  ANY_EMOJI_TOKEN,
  EMOJI_TOKEN,
  LITERAL_SHORTCODE,
  isPhrasing,
  lineOf,
  nodeAt,
  phrasingOf,
} from './phrasing.ts'
import type { PropSchemas } from './props.ts'

/**
 * A route: who sends to whom, as party chips joined by arrows.
 *
 * ```markdown
 * :route[:airbnb: Airbnb, :mail: Postmark → :inbox: Gateway]
 * ```
 *
 * Each party is an emoji and a name; `, ` separates two parties on one side
 * where an emoji leads the second, and `→`, `←`, `↔` or `⇄`, with spaces
 * around it, goes from one side to the next. With no arrow it is a row of
 * chips. Read exactly as lockstay's documentation site reads it
 * (`apps/docs/src/markdown.ts` there), so a page draws the same in both.
 *
 * A step's first line is made of routes too (`timeline.ts`), so the reading
 * and the drawing are shared from here. Outside Quill a route reads as the
 * words and arrows it is written with.
 */

/** The arrows a route goes by, and what each says to someone who cannot see it. */
const ARROW_WORDS: Readonly<Record<string, string>> = {
  '→': 'to',
  '←': 'from',
  '↔': 'to and from',
  '⇄': 'exchanging with',
}

/** An arrow with the spaces around it; the arrow is the group. */
const ARROW = /\s+([→←↔⇄])\s+/u

/** `, ` between two parties on one side, where an emoji leads the second. */
const PARTY_BREAK = new RegExp(`,\\s+(?=${LITERAL_SHORTCODE}|${ANY_EMOJI_TOKEN})`, 'u')

/** The emoji that leads a party, drawn or not; a drawn one's index is the group. */
const LEADING_EMOJI = new RegExp(`^(?:${EMOJI_TOKEN}|${LITERAL_SHORTCODE})\\s*`, 'u')

/** One party: the emoji that leads it, when the page draws one, and its name. */
export interface Party {
  readonly icon: string | undefined
  readonly name: readonly PhrasingContent[]
}

/** One side of a route: the arrow before it (none for the first), and its parties. */
export interface RouteSide {
  readonly arrow: string | undefined
  readonly parties: readonly Party[]
}

function partyOf(line: Line, text: string): Party {
  const lead = LEADING_EMOJI.exec(text)
  const icon = lead === null ? undefined : nodeAt(line, lead[1])
  const name = icon === undefined ? undefined : emojiNameOf(icon)
  // A shortcode no emoji answers to stays part of the name, as written.
  if (lead === null || name === undefined) return { icon: undefined, name: phrasingOf(line, text) }
  return { icon: name, name: phrasingOf(line, text.slice(lead[0].length)) }
}

/** The sides of `A, B → C ↔ D`: the parties before the first arrow, then each arrow's. */
export function routeOf(line: Line, text: string = line.text): RouteSide[] {
  // Split by an arrow it captures: parties, then an arrow and parties, and so on.
  const parts = text.trim().split(ARROW)
  return parts.flatMap((part, index): RouteSide[] =>
    index % 2 === 1
      ? []
      : [
          {
            arrow: index === 0 ? undefined : parts[index - 1],
            parties: part.split(PARTY_BREAK).map((each) => partyOf(line, each)),
          },
        ],
  )
}

/** What drawing a route needs from the block drawing it. */
type Drawing = Pick<BlockRenderInput<PropSchemas>, 'draw' | 'emoji'>

/** A party's chip: its emoji, decoration beside its name, and the name. */
function partyElement(party: Party, { draw, emoji }: Drawing): Element {
  const icon = party.icon === undefined ? undefined : emoji(party.icon, 'decoration')
  return h('span', { className: ['qb-route-party'] }, icon, draw(party.name))
}

/** An arrow, said in words to a screen reader: "Airbnb to Gateway". */
function arrowElement(arrow: string): Element {
  return h(
    'span',
    { className: ['qb-route-to'] },
    h('span', { 'aria-hidden': 'true' }, arrow),
    // Every arrow the pattern finds has its words.
    /* v8 ignore next */
    h('span', { className: ['sr-only'] }, ` ${ARROW_WORDS[arrow] ?? arrow} `),
  )
}

/**
 * A route as party chips. An arrow and the party after it are one leg, which
 * never wraps apart; parties on one side wrap as words do.
 */
export function routeElement(sides: readonly RouteSide[], drawing: Drawing): Element {
  const drawn = sides.flatMap((side): (ElementContent | string)[] => {
    const [first, ...rest] = side.parties
    if (side.arrow === undefined || first === undefined) {
      return side.parties.flatMap((party, index) => [
        ...(index === 0 ? [] : [' ']),
        partyElement(party, drawing),
      ])
    }
    return [
      h(
        'span',
        { className: ['qb-route-leg'] },
        arrowElement(side.arrow),
        partyElement(first, drawing),
      ),
      ...rest.map((party) => partyElement(party, drawing)),
    ]
  })
  return h('span', { className: ['qb-route'] }, drawn)
}

export const routeBlock = defineBlock({
  id: `${BRAND.slug}.route`,
  version: '1.0.0',
  name: 'route',
  title: 'Route',
  description:
    'Who sends to whom: parties, each an emoji and a name, joined by →, ←, ↔ or ⇄, with “, ” between two parties on one side.',
  content: 'inline',
  props: {},
  render: (input) => routeElement(routeOf(lineOf(input.children.filter(isPhrasing))), input),
})
