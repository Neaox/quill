import { toString } from 'mdast-util-to-string'
import type { TextDirective } from 'mdast-util-directive'

import type { Directive, DirectiveDefinition, DirectiveIssue } from './definition.ts'
import { attribute, issue, textChildren } from './definition.ts'

/** The interface badge's tones (`@quill/ui`'s `badgeStyles`), so the two read alike. */
export const BADGE_TONES = ['neutral', 'accent', 'success', 'warning', 'danger'] as const

export type BadgeTone = (typeof BADGE_TONES)[number]

export const DEFAULT_BADGE_TONE: BadgeTone = 'neutral'

/**
 * Shorthands that name the tone instead of saying it: `:ok[Built]` is
 * `:badge[Built]{tone=success}`. Short enough to write in a table cell, and
 * a vocabulary documentation commonly uses.
 */
export const BADGE_SHORTHANDS = {
  ok: 'success',
  warn: 'warning',
  bad: 'danger',
  accent: 'accent',
  plan: 'neutral',
} as const satisfies Readonly<Record<string, BadgeTone>>

export type BadgeName = 'badge' | keyof typeof BADGE_SHORTHANDS

export interface Badge {
  readonly label: string
  readonly tone: BadgeTone
  /** How it was written, so it is written back the same way; `badge` when omitted. */
  readonly name?: BadgeName | undefined
}

function isShorthand(name: string): name is keyof typeof BADGE_SHORTHANDS {
  return Object.hasOwn(BADGE_SHORTHANDS, name)
}

export function isBadgeTone(value: unknown): value is BadgeTone {
  return typeof value === 'string' && (BADGE_TONES as readonly string[]).includes(value)
}

/**
 * The tone a text directive is drawn in when it is a badge, or undefined when
 * it is not one: the reader's renderer and the editor both ask this, so a
 * badge looks the same while it is written as when it is read.
 */
export function badgeTone(
  name: string,
  attributes: Readonly<Record<string, unknown>> | null | undefined,
): BadgeTone | undefined {
  return isShorthand(name) || name === 'badge' ? toneOf(name, attributes) : undefined
}

/** The tone of a directive already known to be a badge. */
function toneOf(
  name: string,
  attributes: Readonly<Record<string, unknown>> | null | undefined,
): BadgeTone {
  if (isShorthand(name)) return BADGE_SHORTHANDS[name]
  const tone = attributes?.['tone']
  return isBadgeTone(tone) ? tone : DEFAULT_BADGE_TONE
}

/**
 * `:badge[Built]{tone=success}` — a short status, such as the state of a piece
 * of work in a table cell. The label is the meaning and the tone only
 * emphasis, so a badge reads the same in monochrome, to a screen reader, and
 * outside Quill, where it is the literal `:badge[Built]{tone=success}`. An
 * unknown tone degrades to neutral (ADR-002).
 */
export const badgeDirective: DirectiveDefinition<Badge, TextDirective> = {
  names: ['badge', ...Object.keys(BADGE_SHORTHANDS)],
  kinds: ['text'],

  parse(node: TextDirective): Badge {
    const name = isShorthand(node.name) ? node.name : 'badge'
    return {
      label: toString(node),
      tone: toneOf(node.name, node.attributes),
      name,
    }
  },

  validate(node: Directive): readonly DirectiveIssue[] {
    // `status:ok` in prose is a directive named `ok` with no label, and is
    // the author's text, not a badge; only a labelled one is checked.
    if (isShorthand(node.name) && node.children.length === 0) return []
    const tone = attribute(node, 'tone')
    const unlabelled =
      toString(node).trim().length > 0
        ? []
        : [issue('', 'A badge needs a label; its text is its meaning.', 'warning')]
    const unknownTone =
      tone === undefined || isBadgeTone(tone)
        ? []
        : [
            issue(
              'tone',
              `Unknown badge tone "${tone}"; rendered as ${DEFAULT_BADGE_TONE}.`,
              'warning',
            ),
          ]
    return [...unlabelled, ...unknownTone]
  },

  serialize(model: Badge): TextDirective {
    const name = model.name ?? 'badge'
    const implicit = name !== 'badge' || model.tone === DEFAULT_BADGE_TONE
    return {
      type: 'textDirective',
      name,
      attributes: implicit ? {} : { tone: model.tone },
      children: textChildren(model.label),
    }
  },
}
