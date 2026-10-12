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

/**
 * A valueless attribute such as the `added` in `:::optional{title="x" added}`.
 * Anything carrying directive attributes can be asked, a details written in
 * HTML included (ADR-048).
 */
export function flag(
  node: { readonly attributes?: DirectiveAttributes | null | undefined },
  name: string,
): boolean {
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

export interface IntegerRange {
  readonly min: number
  readonly max: number
}

/**
 * An attribute read as a whole number inside a closed range, or `undefined` when
 * it is absent, not a number, or out of range. Callers pick their own default,
 * which is what lets a directive degrade rather than fail (ADR-002).
 */
export function integerAttribute(
  attributes: DirectiveAttributes | null | undefined,
  name: string,
  { min, max }: IntegerRange,
): number | undefined {
  const written = attributes?.[name] ?? undefined
  if (written === undefined || !/^\d+$/.test(written)) return undefined
  const value = Number(written)
  return value >= min && value <= max ? value : undefined
}

/** A warning for an attribute that was written but could not be read as a number in range. */
export function integerIssues(
  attributes: DirectiveAttributes | null | undefined,
  name: string,
  range: IntegerRange,
): readonly DirectiveIssue[] {
  const written = attributes?.[name] ?? undefined
  if (written === undefined || integerAttribute(attributes, name, range) !== undefined) return []
  return [
    issue(
      name,
      `"${name}" must be a whole number from ${String(range.min)} to ${String(range.max)}; found "${written}".`,
      'warning',
    ),
  ]
}
