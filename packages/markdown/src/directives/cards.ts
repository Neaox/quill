import type { ContainerDirective } from 'mdast-util-directive'

import type {
  Directive,
  DirectiveContent,
  DirectiveDefinition,
  DirectiveIssue,
} from './definition.ts'
import { attribute, bodyOf, issue } from './definition.ts'

/**
 * How a set of cards is drawn: `panels` are raised surfaces, for cards that
 * hold a figure or a few paragraphs; `ruled` are open columns under an accent
 * rule, for short principles read side by side.
 */
export const CARDS_VARIANTS = ['panels', 'ruled'] as const

export type CardsVariant = (typeof CARDS_VARIANTS)[number]

export const DEFAULT_CARDS_VARIANT: CardsVariant = 'panels'

export interface Cards {
  readonly variant: CardsVariant
  /** Each card's blocks, its heading first when it has one. */
  readonly cards: readonly DirectiveContent[]
}

export function isCardsVariant(value: unknown): value is CardsVariant {
  return typeof value === 'string' && (CARDS_VARIANTS as readonly string[]).includes(value)
}

/**
 * `:::cards` — sections laid side by side. Every heading at the shallowest
 * level inside starts a card, and blocks before the first heading make an
 * untitled one, so the source is ordinary headed Markdown and degrades to
 * exactly that: outside Quill the sections simply follow one another.
 */
export const cardsDirective: DirectiveDefinition<Cards, ContainerDirective> = {
  names: ['cards'],
  kinds: ['container'],

  parse(node: ContainerDirective): Cards {
    const variant = attribute(node, 'variant')
    const body = bodyOf(node)
    const level = Math.min(
      ...body.flatMap((child) => (child.type === 'heading' ? [child.depth] : [])),
    )
    const cards: DirectiveContent[] = []
    for (const child of body) {
      const current = cards.at(-1)
      if (current === undefined || (child.type === 'heading' && child.depth === level)) {
        cards.push([child])
      } else {
        current.push(child)
      }
    }
    return { variant: isCardsVariant(variant) ? variant : DEFAULT_CARDS_VARIANT, cards }
  },

  validate(node: Directive): readonly DirectiveIssue[] {
    const variant = attribute(node, 'variant')
    if (variant === undefined || isCardsVariant(variant)) return []
    return [
      issue(
        'variant',
        `Unknown cards variant "${variant}"; rendered as ${DEFAULT_CARDS_VARIANT}.`,
        'warning',
      ),
    ]
  },

  serialize(model: Cards): ContainerDirective {
    return {
      type: 'containerDirective',
      name: 'cards',
      attributes: model.variant === DEFAULT_CARDS_VARIANT ? {} : { variant: model.variant },
      children: model.cards.flat(),
    }
  },
}
