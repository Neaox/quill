import { Node as PMNode } from 'prosemirror-model'

import { isLayoutDirectiveName } from '../directives/layout.ts'
import { schema } from './schema.ts'

/**
 * ADR-027 layout widths, in the two shapes they take.
 *
 * In Markdown a width is a `:::wide` or `:::full` wrapper. In the editor it is a
 * property of the block itself, because "the wrapper is not shown as a separate
 * block": the author sees the table at its chosen width, exactly as a reader will.
 * `liftLayout` converts the first shape into the second when a document is opened
 * and `wrapLayout` converts it back when the document is saved. Measured lossless
 * in both directions over the fidelity corpus (research R3 section 3).
 *
 * Two normalisations are inherent and accepted: two adjacent wrappers of the same
 * width merge into one, and a wrapper whose blocks cannot carry the attribute —
 * front matter, a link reference definition — is left in place as a container.
 */

/** ProseMirror's document JSON. Nodes are immutable, so the lift works on JSON. */
interface NodeJson {
  readonly type: string
  readonly attrs?: Record<string, unknown>
  readonly content?: readonly NodeJson[]
  readonly text?: string
  readonly marks?: readonly unknown[]
}

const LAYOUT_CAPABLE: ReadonlySet<string> = new Set(
  Object.entries(schema.nodes)
    .filter(([, type]) => type.spec.attrs !== undefined && Object.hasOwn(type.spec.attrs, 'layout'))
    .map(([name]) => name),
)

function attrsOf(node: NodeJson): Record<string, unknown> {
  return node.attrs ?? {}
}

function contentOf(node: NodeJson): readonly NodeJson[] {
  return node.content ?? []
}

function attributeCount(value: unknown): number {
  return typeof value === 'object' && value !== null ? Object.keys(value).length : 0
}

/** The blocks a wrapper holds, if it is a plain layout wrapper they can all carry. */
function liftableChildren(node: NodeJson): readonly NodeJson[] | undefined {
  const attrs = attrsOf(node)
  if (attributeCount(attrs['attributes']) > 0) return undefined
  if (node.type !== 'containerDirective') return undefined
  if (!isLayoutDirectiveName(attrs['name'])) return undefined
  const children = contentOf(node)
  const liftable = children.every(
    (child) => LAYOUT_CAPABLE.has(child.type) && attrsOf(child)['layout'] === null,
  )
  return liftable ? children : undefined
}

function liftChildren(nodes: readonly NodeJson[]): NodeJson[] {
  return nodes.flatMap((node) => {
    const lifted = { ...node, content: liftChildren(contentOf(node)) }
    const children = liftableChildren(lifted)
    if (children === undefined) return [node.content === undefined ? node : lifted]
    const width = attrsOf(lifted)['name']
    return children.map((child) => ({ ...child, attrs: { ...attrsOf(child), layout: width } }))
  })
}

function wrapChildren(nodes: readonly NodeJson[]): NodeJson[] {
  const out: NodeJson[] = []
  let open: { readonly width: string; readonly content: NodeJson[] } | undefined
  for (const node of nodes) {
    const lowered =
      node.content === undefined ? node : { ...node, content: wrapChildren(node.content) }
    const width = attrsOf(lowered)['layout']
    if (!isLayoutDirectiveName(width)) {
      open = undefined
      out.push(lowered)
      continue
    }
    const stripped = { ...lowered, attrs: { ...attrsOf(lowered), layout: null } }
    if (open !== undefined && open.width === width) {
      open.content.push(stripped)
      continue
    }
    open = { width, content: [stripped] }
    out.push({
      type: 'containerDirective',
      attrs: { name: width, attributes: {}, layout: null },
      content: open.content,
    })
  }
  return out
}

function rebuild(doc: PMNode, transform: (nodes: readonly NodeJson[]) => NodeJson[]): PMNode {
  const json: NodeJson = doc.toJSON()
  const next = PMNode.fromJSON(schema, { ...json, content: transform(contentOf(json)) })
  next.check()
  return next
}

/** Turns `:::wide` wrappers into a `layout` attribute on the blocks they held. */
export function liftLayout(doc: PMNode): PMNode {
  return rebuild(doc, liftChildren)
}

/** Turns `layout` attributes back into the fewest `:::wide` wrappers that express them. */
export function wrapLayout(doc: PMNode): PMNode {
  return rebuild(doc, wrapChildren)
}
