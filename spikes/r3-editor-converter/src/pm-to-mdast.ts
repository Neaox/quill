// ProseMirror document -> mdast.
import type { Mark, Node as PMNode } from 'prosemirror-model'
import type { Warning } from './mdast-to-pm.ts'

// Outermost first. `code` is last because mdast's inlineCode is a leaf: nothing
// can nest inside it.
const MARK_ORDER = ['link', 'bold', 'italic', 'strike', 'code']

const children = (n: PMNode): PMNode[] => {
  const out: PMNode[] = []
  n.forEach((child) => out.push(child))
  return out
}

// --- inline ---------------------------------------------------------------

function leaf(n: PMNode, warn: Warning[]): any {
  switch (n.type.name) {
    case 'text':
      return { type: 'text', value: n.text ?? '' }
    case 'hardBreak':
      return { type: 'break' }
    case 'htmlInline':
      return { type: 'html', value: n.attrs.value }
    case 'image':
      return n.attrs.referenceType
        ? {
            type: 'imageReference',
            alt: n.attrs.alt,
            identifier: n.attrs.identifier,
            label: n.attrs.label,
            referenceType: n.attrs.referenceType,
          }
        : { type: 'image', url: n.attrs.src, alt: n.attrs.alt, title: n.attrs.title }
    case 'footnoteReference':
      return { type: 'footnoteReference', identifier: n.attrs.identifier, label: n.attrs.label }
    case 'textDirective':
      return {
        type: 'textDirective',
        name: n.attrs.name,
        attributes: n.attrs.attributes,
        children: inlineToMdast(children(n), [], warn),
      }
    default:
      warn.push({ code: 'unknown-inline-node', detail: n.type.name })
      return { type: 'text', value: n.textContent }
  }
}

function wrap(name: string, m: Mark | undefined, kids: any[], warn: Warning[]): any {
  switch (name) {
    case 'bold':
      return { type: 'strong', children: kids }
    case 'italic':
      return { type: 'emphasis', children: kids }
    case 'strike':
      return { type: 'delete', children: kids }
    case 'code':
      return { type: 'inlineCode', value: kids.map((k) => k.value ?? '').join('') }
    case 'link': {
      const attrs = m?.attrs ?? {}
      if (attrs.referenceType) {
        return {
          type: 'linkReference',
          identifier: attrs.identifier,
          label: attrs.label,
          referenceType: attrs.referenceType,
          children: kids,
        }
      }
      return { type: 'link', url: attrs.href, title: attrs.title ?? null, children: kids }
    }
    default:
      warn.push({ code: 'unknown-mark', detail: name })
      return { type: 'text', value: kids.map((k) => k.value ?? '').join('') }
  }
}

function inlineToMdast(nodes: PMNode[], active: string[], warn: Warning[]): any[] {
  const out: any[] = []
  let i = 0
  while (i < nodes.length) {
    const n = nodes[i]
    const pending = MARK_ORDER.find(
      (name) => !active.includes(name) && n.marks.some((m) => m.type.name === name),
    )
    if (!pending) {
      out.push(leaf(n, warn))
      i += 1
      continue
    }
    const instance = n.marks.find((m) => m.type.name === pending)
    let j = i + 1
    while (
      j < nodes.length &&
      nodes[j].marks.some((m) => m.type.name === pending && m.eq(instance!))
    )
      j += 1
    out.push(
      wrap(pending, instance, inlineToMdast(nodes.slice(i, j), active.concat(pending), warn), warn),
    )
    i = j
  }
  return out
}

// --- blocks ---------------------------------------------------------------

function itemChildren(item: PMNode, warn: Warning[]): any[] {
  const kids = children(item)
  const trimmed =
    kids.length > 1 &&
    kids[0].type.name === 'paragraph' &&
    kids[0].attrs.synthetic &&
    kids[0].content.size === 0
      ? kids.slice(1)
      : kids
  return trimmed.flatMap((child) => blockToMdast(child, warn))
}

function blockToMdast(n: PMNode, warn: Warning[]): any[] {
  switch (n.type.name) {
    case 'frontMatter':
      return [{ type: 'yaml', value: n.attrs.value }]
    case 'paragraph': {
      const out: any = { type: 'paragraph', children: inlineToMdast(children(n), [], warn) }
      if (n.attrs.directiveLabel) out.data = { directiveLabel: true }
      return [out]
    }
    case 'heading':
      return [
        { type: 'heading', depth: n.attrs.level, children: inlineToMdast(children(n), [], warn) },
      ]
    case 'blockquote':
      return [{ type: 'blockquote', children: children(n).flatMap((c) => blockToMdast(c, warn)) }]
    case 'bulletList':
    case 'taskList':
      return [
        {
          type: 'list',
          ordered: false,
          start: null,
          spread: n.attrs.spread ?? false,
          children: children(n).map((item) => ({
            type: 'listItem',
            spread: item.attrs.spread ?? false,
            checked:
              item.type.name === 'taskItem'
                ? item.attrs.checked === true
                : (item.attrs.checked ?? null),
            children: itemChildren(item, warn),
          })),
        },
      ]
    case 'orderedList':
      return [
        {
          type: 'list',
          ordered: true,
          start: n.attrs.start ?? 1,
          spread: n.attrs.spread ?? false,
          children: children(n).map((item) => ({
            type: 'listItem',
            spread: item.attrs.spread ?? false,
            checked: item.attrs.checked ?? null,
            children: itemChildren(item, warn),
          })),
        },
      ]
    case 'codeBlock':
      return [{ type: 'code', lang: n.attrs.language, meta: n.attrs.meta, value: n.textContent }]
    case 'horizontalRule':
      return [{ type: 'thematicBreak' }]
    case 'htmlBlock':
      return [{ type: 'html', value: n.textContent }]
    case 'table':
      return [
        {
          type: 'table',
          align: n.attrs.align,
          children: children(n).map((row) => ({
            type: 'tableRow',
            children: children(row).map((cell) => {
              const kids = children(cell)
              if (kids.length === 1 && kids[0].type.name === 'paragraph') {
                return { type: 'tableCell', children: inlineToMdast(children(kids[0]), [], warn) }
              }
              warn.push({ code: 'table-cell-flattened', detail: `${kids.length} blocks` })
              return { type: 'tableCell', children: [{ type: 'text', value: cell.textContent }] }
            }),
          })),
        },
      ]
    case 'containerDirective':
      return [
        {
          type: 'containerDirective',
          name: n.attrs.name,
          attributes: n.attrs.attributes ?? {},
          children: children(n).flatMap((c) => blockToMdast(c, warn)),
        },
      ]
    case 'leafDirective':
      return [
        {
          type: 'leafDirective',
          name: n.attrs.name,
          attributes: n.attrs.attributes ?? {},
          children: inlineToMdast(children(n), [], warn),
        },
      ]
    case 'definition':
      return [
        {
          type: 'definition',
          identifier: n.attrs.identifier,
          label: n.attrs.label,
          url: n.attrs.url,
          title: n.attrs.title,
        },
      ]
    case 'footnoteDefinition':
      return [
        {
          type: 'footnoteDefinition',
          identifier: n.attrs.identifier,
          label: n.attrs.label,
          children: children(n).flatMap((c) => blockToMdast(c, warn)),
        },
      ]
    case 'rawMdast':
      return [n.attrs.node]
    default:
      warn.push({ code: 'unknown-block-node', detail: n.type.name })
      return [{ type: 'paragraph', children: [{ type: 'text', value: n.textContent }] }]
  }
}

export function proseMirrorToMdast(doc: PMNode): { tree: any; warnings: Warning[] } {
  const warnings: Warning[] = []
  return {
    tree: { type: 'root', children: children(doc).flatMap((c) => blockToMdast(c, warnings)) },
    warnings,
  }
}
