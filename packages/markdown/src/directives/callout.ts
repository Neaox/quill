import type { ContainerDirective } from 'mdast-util-directive'

import type {
  Directive,
  DirectiveContent,
  DirectiveDefinition,
  DirectiveIssue,
} from './definition.ts'
import { attribute, bodyOf, issue, label, labelParagraph } from './definition.ts'

export const CALLOUT_TYPES = ['note', 'info', 'tip', 'warning', 'caution'] as const

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
