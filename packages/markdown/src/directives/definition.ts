import { toString } from 'mdast-util-to-string'
import type { ContainerDirective, LeafDirective, TextDirective } from 'mdast-util-directive'
import type { Paragraph, PhrasingContent } from 'mdast'

/** Any of the three directive shapes of ADR-002: `:::name`, `::name`, `:name`. */
export type Directive = ContainerDirective | LeafDirective | TextDirective

export type DirectiveKind = 'container' | 'leaf' | 'text'

export type DirectiveAttributes = Readonly<Record<string, string | null | undefined>>

/** Block children a container directive may hold. */
export type DirectiveContent = ContainerDirective['children']

/** A problem found in a directive. Reported, never thrown; directives degrade. */
export interface DirectiveIssue {
  readonly path: string
  readonly message: string
  readonly severity: 'error' | 'warning'
}

/**
 * The half of a directive definition the registry needs: which syntax it claims
 * and whether a given occurrence of it is well formed.
 */
export interface DirectiveValidator {
  readonly names: readonly string[]
  readonly kinds: readonly DirectiveKind[]
  validate(node: Directive): readonly DirectiveIssue[]
}

/**
 * One directive, defined once (ADR-004): the syntax it claims, how to read it
 * into a model, how to check it, and how to write it back.
 */
export interface DirectiveDefinition<
  Model,
  Node extends Directive = Directive,
> extends DirectiveValidator {
  parse(node: Node): Model
  serialize(model: Model): Node
}

const KIND_BY_TYPE: Readonly<Record<Directive['type'], DirectiveKind>> = {
  containerDirective: 'container',
  leafDirective: 'leaf',
  textDirective: 'text',
}

export function directiveKind(node: Directive): DirectiveKind {
  return KIND_BY_TYPE[node.type]
}

export function isDirective(node: { readonly type: string }): node is Directive {
  return Object.hasOwn(KIND_BY_TYPE, node.type)
}

/** True when this occurrence is one the given definition claims. */
export function claims(definition: DirectiveValidator, node: Directive): boolean {
  return definition.names.includes(node.name) && definition.kinds.includes(directiveKind(node))
}

export function attribute(node: Directive, name: string): string | undefined {
  return node.attributes?.[name] ?? undefined
}

/** A valueless attribute such as the `added` in `:::optional{title="x" added}`. */
export function flag(node: Directive, name: string): boolean {
  const attributes = node.attributes
  if (!attributes) return false
  if (!Object.hasOwn(attributes, name)) return false
  const value = attributes[name]
  return value !== 'false'
}

function isLabelParagraph(node: DirectiveContent[number]): node is Paragraph {
  return node.type === 'paragraph' && node.data?.directiveLabel === true
}

/** The `[Label]` of `:::name[Label]`, if one was written. */
export function label(node: Directive): string | undefined {
  if (node.type !== 'containerDirective') return toString(node)
  const first = node.children[0]
  if (first === undefined || !isLabelParagraph(first)) return undefined
  return toString(first)
}

/** A directive's children with the `[Label]` paragraph removed. */
export function bodyOf(node: ContainerDirective): DirectiveContent {
  const [first, ...rest] = node.children
  if (first === undefined) return []
  return isLabelParagraph(first) ? rest : node.children
}

export function labelParagraph(text: string): Paragraph {
  return {
    type: 'paragraph',
    data: { directiveLabel: true },
    children: [{ type: 'text', value: text }],
  }
}

export function issue(
  path: string,
  message: string,
  severity: DirectiveIssue['severity'],
): DirectiveIssue {
  return { path, message, severity }
}

export function textChildren(value: string): PhrasingContent[] {
  return [{ type: 'text', value }]
}
