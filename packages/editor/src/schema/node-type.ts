import type { MarkType, NodeType, Schema } from '@tiptap/pm/model'

/**
 * Looking a type up by name, with the failure named.
 *
 * ProseMirror's `schema.nodes` is an index signature, so every lookup is possibly
 * undefined and every call site would otherwise carry its own guard. A missing
 * name is a programming error — the Markdown package publishes the node set — so
 * it is worth one clear message rather than a `Cannot read properties of
 * undefined` several frames away.
 */
export function nodeType(schema: Schema, name: string): NodeType {
  const type = schema.nodes[name]
  if (type === undefined) throw new Error(`The schema has no "${name}" node.`)
  return type
}

export function markType(schema: Schema, name: string): MarkType {
  const type = schema.marks[name]
  if (type === undefined) throw new Error(`The schema has no "${name}" mark.`)
  return type
}
