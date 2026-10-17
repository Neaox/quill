import type { ContainerDirective } from 'mdast-util-directive'

import type {
  Directive,
  DirectiveContent,
  DirectiveDefinition,
  DirectiveIssue,
} from './definition.ts'
import { attribute, bodyOf, issue, label, labelParagraph } from './definition.ts'

/**
 * The callout kinds: GitHub's five alert kinds (`> [!NOTE]`, rendered as
 * callouts by `handlers.ts`), and `info`, which Quill had first.
 */
export const CALLOUT_TYPES = ['note', 'info', 'tip', 'important', 'warning', 'caution'] as const

export type CalloutType = (typeof CALLOUT_TYPES)[number]

export const DEFAULT_CALLOUT_TYPE: CalloutType = 'note'

export interface Callout {
  readonly type: CalloutType
  readonly label: string | undefined
  readonly children: DirectiveContent
}

export function isCalloutType(value: unknown): value is CalloutType {
  return typeof value === 'string' && (CALLOUT_TYPES as readonly string[]).includes(value)
}

/**
 * Obsidian's callout kinds and their aliases, onto Quill's (ADR-036). A kind
 * neither knows is drawn as a note, the way an unknown `:::callout` type is.
 */
const CALLOUT_ALIASES: Readonly<Record<string, CalloutType>> = {
  abstract: 'note',
  summary: 'note',
  tldr: 'note',
  example: 'note',
  quote: 'note',
  cite: 'note',
  todo: 'info',
  question: 'info',
  help: 'info',
  faq: 'info',
  success: 'tip',
  check: 'tip',
  done: 'tip',
  hint: 'tip',
  attention: 'warning',
  failure: 'caution',
  fail: 'caution',
  missing: 'caution',
  danger: 'caution',
  error: 'caution',
  bug: 'caution',
}

/** The callout a kind is drawn as, or undefined when it is no kind Quill or Obsidian knows. */
export function knownCalloutKind(kind: string): CalloutType | undefined {
  const lower = kind.toLowerCase()
  return isCalloutType(lower) ? lower : CALLOUT_ALIASES[lower]
}

/**
 * `:::callout{type=warning}` — an aside the reader is meant to notice. An unknown
 * type degrades to `note` rather than failing, so a document written against a
 * newer vocabulary still renders (ADR-002).
 */
export const calloutDirective: DirectiveDefinition<Callout, ContainerDirective> = {
  names: ['callout'],
  kinds: ['container'],

  parse(node: ContainerDirective): Callout {
    const type = attribute(node, 'type')
    return {
      type: isCalloutType(type) ? type : DEFAULT_CALLOUT_TYPE,
      label: label(node),
      children: bodyOf(node),
    }
  },

  validate(node: Directive): readonly DirectiveIssue[] {
    const type = attribute(node, 'type')
    if (type === undefined || isCalloutType(type)) return []
    return [
      issue(
        'type',
        `Unknown callout type "${type}"; rendered as ${DEFAULT_CALLOUT_TYPE}.`,
        'warning',
      ),
    ]
  },

  serialize(model: Callout): ContainerDirective {
    const body =
      model.label === undefined ? model.children : [labelParagraph(model.label), ...model.children]
    return {
      type: 'containerDirective',
      name: 'callout',
      attributes: { type: model.type },
      children: body,
    }
  },
}
