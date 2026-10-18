import type { Node as PMNode } from '@tiptap/pm/model'

/**
 * A directive node's `attributes`, as the strings the Markdown syntax carries.
 *
 * The schema stores them as an open record because an unknown directive's
 * attributes must survive a round trip (AGENTS.md rule 7), so every reader of
 * them has the same job: treat the value as untrusted and read it as text.
 */
export function directiveAttributes(node: PMNode): Readonly<Record<string, string>> {
  const attributes: unknown = node.attrs['attributes']
  if (typeof attributes !== 'object' || attributes === null) return {}
  return Object.fromEntries(
    Object.entries(attributes).map(([key, value]) => [key, String(value ?? '')]),
  )
}

/** The directive's name, or `undefined` for a node that is not a directive. */
export function directiveName(node: PMNode): string | undefined {
  const name: unknown = node.attrs['name']
  return typeof name === 'string' ? name : undefined
}
