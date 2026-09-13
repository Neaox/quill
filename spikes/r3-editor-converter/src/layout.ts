// ADR-027 block layout widths.
//
// Two representations of the same Markdown:
//
//   wrapper — ":::wide" is a containerDirective node in the ProseMirror doc.
//   attr    — ":::wide" is lifted away and each block it wrapped carries
//             layout="wide". This is what ADR-027 asks the editor to show:
//             "the wrapper is never shown as a separate block".
//
// liftLayout/lowerLayout convert between them. They operate on ProseMirror JSON
// because ProseMirror nodes are immutable.
import { Node as PMNode } from 'prosemirror-model'
import { schema } from './schema.ts'

const LAYOUT_NAMES = new Set(['wide', 'full'])

const supportsLayout = (type: string) => Boolean(schema.nodes[type]?.spec.attrs?.layout)

function liftChildren(nodes: any[]): any[] {
  const out: any[] = []
  for (const n of nodes ?? []) {
    const lifted = { ...n }
    if (lifted.content) lifted.content = liftChildren(lifted.content)
    const isLayoutWrapper =
      lifted.type === 'containerDirective' &&
      LAYOUT_NAMES.has(lifted.attrs?.name) &&
      Object.keys(lifted.attrs?.attributes ?? {}).length === 0 &&
      (lifted.content ?? []).every((c: any) => supportsLayout(c.type) && c.attrs?.layout == null)
    if (isLayoutWrapper) {
      for (const child of lifted.content ?? []) {
        out.push({ ...child, attrs: { ...child.attrs, layout: lifted.attrs.name } })
      }
    } else {
      out.push(lifted)
    }
  }
  return out
}

function lowerChildren(nodes: any[]): any[] {
  const out: any[] = []
  let i = 0
  const list = nodes ?? []
  while (i < list.length) {
    const n = { ...list[i] }
    if (n.content) n.content = lowerChildren(n.content)
    const layout = n.attrs?.layout
    if (!layout) {
      out.push(n)
      i += 1
      continue
    }
    const run: any[] = []
    while (i < list.length && list[i].attrs?.layout === layout) {
      const child = { ...list[i] }
      if (child.content) child.content = lowerChildren(child.content)
      run.push({ ...child, attrs: { ...child.attrs, layout: null } })
      i += 1
    }
    out.push({
      type: 'containerDirective',
      attrs: { name: layout, attributes: {}, layout: null },
      content: run,
    })
  }
  return out
}

export function liftLayout(doc: PMNode): PMNode {
  const json: any = doc.toJSON()
  const next = PMNode.fromJSON(schema, { ...json, content: liftChildren(json.content ?? []) })
  next.check()
  return next
}

export function lowerLayout(doc: PMNode): PMNode {
  const json: any = doc.toJSON()
  const next = PMNode.fromJSON(schema, { ...json, content: lowerChildren(json.content ?? []) })
  next.check()
  return next
}
