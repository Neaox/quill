import { BRAND } from '@quill/brand'
import type { Element, ElementContent } from 'hast'
import type { PhrasingContent, Strong } from 'mdast'

import { emojiNameOf } from '../emoji/emoji.ts'
import type { BlockRenderInput } from './define.ts'
import { defineBlock, h } from './define.ts'
import type { Line } from './phrasing.ts'
import {
  EMOJI_TOKEN,
  LITERAL_SHORTCODE,
  NODE_TOKEN,
  lineOf,
  nodeAt,
  phrasingOf,
} from './phrasing.ts'
import type { PropSchemas } from './props.ts'
import { p } from './props.ts'
import type { RouteSide } from './route.ts'
import { routeElement, routeOf } from './route.ts'

/**
 * A timeline of steps on a rail:
 *
 * ```markdown
 * ::::timeline
 * :::step{icon=northgate tone=outside}
 * :clock: **Seconds later** · :northgate: Northgate → :rookwood: Gateway
 *
 * ### Rookwood saves the hold, then tells Northgate
 *
 * The gateway saves it to the ingest log, then replies.
 * :::
 * ::::
 * ```
 *
 * The timeline is an ordered list and each step one of its items, with its
 * icon in a node on the rail. A step's first line, when it is not a
 * heading, is its when-line: the bold words are a chip (a time when an emoji
 * leads them), and each part after a ` · ` is a route. A line with no bold
 * words first is routes alone. It is read the same wherever the kit is
 * drawn, so a page is drawn the same in every renderer of it.
 *
 * Outside Quill the directive lines read as text and the content as Markdown.
 */

/** The tones a node takes: a ring for something outside, green for a safety net. */
export const STEP_TONES = ['outside', 'net'] as const

/** ` · ` between a when-line's chip and its routes, and between two routes. */
const WHEN_BREAK = /[ \t]+·[ \t]+/u

/**
 * A when-line: an optional emoji, bold words, then optionally ` · ` and the
 * routes. The emoji (drawn or not) is the first group or nothing, the bold
 * words' node the second, the routes the third.
 */
const WHEN = new RegExp(
  `^(?:(?:${EMOJI_TOKEN}|${LITERAL_SHORTCODE})[ \\t]+)?${NODE_TOKEN}(?:[ \\t]+·[ \\t]+([\\s\\S]+))?$`,
  'u',
)

/** The leading shortcode no emoji answers to, which stays in the chip as written. */
const LEADING_LITERAL = new RegExp(`^(${LITERAL_SHORTCODE})[ \\t]+`, 'u')

/** A part of a when-line: a route, or a route block written whole (`:route[…]`). */
type WhenRoute =
  | { readonly kind: 'route'; readonly sides: readonly RouteSide[] }
  | { readonly kind: 'written'; readonly node: PhrasingContent }

export interface When {
  /** The emoji that leads the chip, when the page draws one. */
  readonly icon: string | undefined
  /** The chip's words: the bold words, and a shortcode nothing draws before them. */
  readonly chip: readonly PhrasingContent[] | undefined
  readonly routes: readonly WhenRoute[]
}

/** The token a whole part of a line is, when it is nothing but one node. */
const ONLY_NODE = new RegExp(`^${NODE_TOKEN}$`, 'u')

function routesOf(line: Line, text: string | undefined): WhenRoute[] {
  if (text === undefined) return []
  return text.split(WHEN_BREAK).map((part): WhenRoute => {
    const only = nodeAt(line, ONLY_NODE.exec(part.trim())?.[1])
    if (only?.type === 'textDirective' && only.name === 'route') {
      return { kind: 'written', node: only }
    }
    return { kind: 'route', sides: routeOf(line, part) }
  })
}

function isStrong(node: PhrasingContent | undefined): node is Strong {
  return node?.type === 'strong'
}

/** Reads a step's first line, `:clock: **Up to 5 s later** · :rookwood: Worker → :calendar: Catalogue`. */
export function whenOf(children: readonly PhrasingContent[]): When {
  const line = lineOf(children)
  const text = line.text.trim()
  const match = WHEN.exec(text)
  const bold = nodeAt(line, match?.[2])
  if (match === null || !isStrong(bold)) {
    return { icon: undefined, chip: undefined, routes: routesOf(line, text) }
  }
  const lead = nodeAt(line, match[1])
  const icon = lead === undefined ? undefined : emojiNameOf(lead)
  const literal = LEADING_LITERAL.exec(text)?.[1]
  const written = literal === undefined ? [] : phrasingOf(line, `${literal} `)
  return { icon, chip: [...written, ...bold.children], routes: routesOf(line, match[3]) }
}

type Drawing = Pick<BlockRenderInput<PropSchemas>, 'draw' | 'emoji'>

/** The when-line: the chip, then each route. */
function whenElement(when: When, drawing: Drawing): Element {
  const { draw, emoji } = drawing
  const parts: ElementContent[] = []
  if (when.chip !== undefined) {
    const icon = when.icon === undefined ? undefined : emoji(when.icon, 'decoration')
    parts.push(
      icon === undefined
        ? h('span', { className: ['badge', 'qb-step-chip'] }, draw([...when.chip]))
        : h(
            'span',
            { className: ['badge', 'qb-step-chip', 'qb-step-time'], 'data-tone': 'accent' },
            icon,
            draw([...when.chip]),
          ),
    )
  }
  for (const route of when.routes) {
    parts.push(
      ...(route.kind === 'written' ? draw([route.node]) : [routeElement(route.sides, drawing)]),
    )
  }
  return h(
    'p',
    { className: ['qb-step-when'] },
    parts.flatMap((part, index) => (index === 0 ? [part] : [' ', part])),
  )
}

/** A node on the rail, or a member's mark: an emoji in a disc, or a ring for something outside. */
export function nodeElement(
  className: string,
  icon: Element | undefined,
  tone: string | undefined,
): Element {
  return h('span', { className: [className], 'data-qb-tone': tone }, icon)
}

export const timelineBlock = defineBlock({
  id: `${BRAND.slug}.timeline`,
  version: '1.0.0',
  name: 'timeline',
  title: 'Timeline',
  description: 'Steps on a rail, in order: each with an icon, a when-line, a heading and its text.',
  content: { items: 'step' },
  props: {},
  render: ({ items }) => h('ol', {}, items),
})

export const stepBlock = defineBlock({
  id: `${BRAND.slug}.step`,
  version: '1.0.0',
  name: 'step',
  title: 'Step',
  description:
    'One moment of a timeline: its icon on the rail, a when-line of a chip and routes, then a heading and its text.',
  content: 'blocks',
  within: ['timeline'],
  props: {
    icon: p.string({
      title: 'Icon',
      description: 'The emoji drawn in the step’s node on the rail, by name.',
      examples: ['clock', 'inbox'],
    }),
    tone: p.enum(STEP_TONES, {
      title: 'Tone',
      description: 'A ring for something outside the system, or green for a safety net.',
    }),
  },
  data: ['data-qb-tone'],
  render: (input) => {
    const { props, children, draw, emoji } = input
    const [first, ...rest] = children
    const when = first?.type === 'paragraph' ? whenOf(first.children) : undefined
    const icon = props.icon === undefined ? undefined : emoji(props.icon, 'decoration')
    return h(
      'li',
      {},
      nodeElement('qb-step-node', icon, props.tone),
      when === undefined ? undefined : whenElement(when, input),
      draw(when === undefined ? children : rest),
    )
  },
})
