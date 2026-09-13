import type { ContainerDirective } from 'mdast-util-directive'

import type {
  Directive,
  DirectiveContent,
  DirectiveDefinition,
  DirectiveIssue,
} from './definition.ts'
import { bodyOf, issue } from './definition.ts'

/** ADR-027: every block reads at one of three widths. `content` is the default. */
export const LAYOUT_WIDTHS = ['content', 'wide', 'full'] as const

export type LayoutWidth = (typeof LAYOUT_WIDTHS)[number]

/** The two widths that are written as a wrapper; `content` needs no directive. */
export const LAYOUT_DIRECTIVE_NAMES = ['wide', 'full'] as const

export type LayoutDirectiveName = (typeof LAYOUT_DIRECTIVE_NAMES)[number]

export interface LayoutBlock {
  readonly width: LayoutDirectiveName
  readonly children: DirectiveContent
}

export function isLayoutWidth(value: unknown): value is LayoutWidth {
  return typeof value === 'string' && (LAYOUT_WIDTHS as readonly string[]).includes(value)
}

export function isLayoutDirectiveName(value: unknown): value is LayoutDirectiveName {
  return typeof value === 'string' && (LAYOUT_DIRECTIVE_NAMES as readonly string[]).includes(value)
}

/**
 * `:::wide` and `:::full` (ADR-027). A renderer that ignores directives shows the
 * inner blocks unchanged, which is the whole point of expressing width as a
 * wrapper rather than as an attribute on the block.
 */
export const layoutDirective: DirectiveDefinition<LayoutBlock, ContainerDirective> = {
  names: [...LAYOUT_DIRECTIVE_NAMES],
  kinds: ['container'],

  parse(node: ContainerDirective): LayoutBlock {
    return {
      width: isLayoutDirectiveName(node.name) ? node.name : 'wide',
      children: bodyOf(node),
    }
  },

  validate(node: Directive): readonly DirectiveIssue[] {
    const attributes = Object.keys(node.attributes ?? {})
    if (attributes.length === 0) return []
    return [
      issue(
        'attributes',
        `A layout wrapper takes no attributes; found ${attributes.join(', ')}.`,
        'warning',
      ),
    ]
  },

  serialize(model: LayoutBlock): ContainerDirective {
    return {
      type: 'containerDirective',
      name: model.width,
      attributes: {},
      children: model.children,
    }
  },
}
