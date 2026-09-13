// mdast -> ProseMirror document.
import { Mark, Node as PMNode } from 'prosemirror-model'
import { schema } from './schema.ts'

export type Warning = { code: string; detail: string }

// A source-wrapped paragraph is a single mdast text node containing "\n".
// ProseMirror text nodes can hold a newline, but no editor ever produces one:
// the moment an author touches the paragraph the newline is gone. "collapse"
// models what a live editor does; "preserve" models the converter in isolation.
export const options = { softBreaks: 'preserve' as 'preserve' | 'collapse' }

const node = (name: string, attrs: Record<string, unknown> | null, content?: PMNode[]) =>
  schema.nodes[name].create(attrs, content && content.length > 0 ? content : undefined)

const text = (value: string, marks: Mark[]) => (value.length > 0 ? [schema.text(value, marks)] : [])

const mark = (name: string, attrs?: Record<string, unknown>) => schema.marks[name].create(attrs)

const emptyParagraph = () => node('paragraph', { synthetic: true })

// --- inline ---------------------------------------------------------------

function inlineNodes(children: any[], marks: Mark[], warn: Warning[]): PMNode[] {
  const out: PMNode[] = []
  for (const child of children ?? []) out.push(...inlineNode(child, marks, warn))
  return out
}

function inlineNode(n: any, marks: Mark[], warn: Warning[]): PMNode[] {
  switch (n.type) {
    case 'text':
      return text(options.softBreaks === 'collapse' ? n.value.replace(/\n/g, ' ') : n.value, marks)
    case 'emphasis':
      return inlineNodes(n.children, marks.concat(mark('italic')), warn)
    case 'strong':
      return inlineNodes(n.children, marks.concat(mark('bold')), warn)
    case 'delete':
      return inlineNodes(n.children, marks.concat(mark('strike')), warn)
    case 'inlineCode':
      return text(n.value, marks.concat(mark('code')))
    case 'break':
      return [node('hardBreak', null).mark(marks)]
    case 'link':
      return inlineNodes(
        n.children,
        marks.concat(
          mark('link', {
            href: n.url,
            title: n.title ?? null,
            referenceType: null,
            identifier: null,
            label: null,
          }),
        ),
        warn,
      )
    case 'linkReference':
      return inlineNodes(
        n.children,
        marks.concat(
          mark('link', {
            href: null,
            title: null,
            referenceType: n.referenceType,
            identifier: n.identifier,
            label: n.label ?? null,
          }),
        ),
        warn,
      )
    case 'image':
      return [
        node('image', {
          src: n.url,
          alt: n.alt ?? null,
          title: n.title ?? null,
          referenceType: null,
          identifier: null,
          label: null,
        }).mark(marks),
      ]
    case 'imageReference':
      return [
        node('image', {
          src: null,
          alt: n.alt ?? null,
          title: null,
          referenceType: n.referenceType,
          identifier: n.identifier,
          label: n.label ?? null,
        }).mark(marks),
      ]
    case 'html':
      return [node('htmlInline', { value: n.value }).mark(marks)]
    case 'footnoteReference':
      return [
        node('footnoteReference', { identifier: n.identifier, label: n.label ?? null }).mark(marks),
      ]
    case 'textDirective':
      return [
        node(
          'textDirective',
          { name: n.name, attributes: n.attributes ?? {} },
          inlineNodes(n.children, [], warn),
        ).mark(marks),
      ]
    default:
      warn.push({ code: 'unsupported-inline', detail: n.type })
      return text(String(n.value ?? ''), marks)
  }
}

// --- blocks ---------------------------------------------------------------

function blocks(children: any[], warn: Warning[]): PMNode[] {
  const out: PMNode[] = []
  for (const child of children ?? []) out.push(...block(child, warn))
  return out
}

function listKind(n: any): 'orderedList' | 'taskList' | 'bulletList' {
  if (n.ordered) return 'orderedList'
  const items = n.children ?? []
  if (items.length > 0 && items.every((i: any) => i.checked === true || i.checked === false))
    return 'taskList'
  return 'bulletList'
}

function listItem(item: any, kind: string, warn: Warning[]): PMNode {
  let content = blocks(item.children, warn)
  if (content.length === 0 || content[0].type.name !== 'paragraph') {
    content = [emptyParagraph(), ...content]
  }
  if (kind === 'taskList') {
    return node(
      'taskItem',
      { checked: item.checked === true, spread: item.spread ?? null },
      content,
    )
  }
  return node('listItem', { checked: item.checked ?? null, spread: item.spread ?? null }, content)
}

function tableCell(cell: any, type: string, warn: Warning[]): PMNode {
  const inline = inlineNodes(cell.children, [], warn)
  return node(type, { colspan: 1, rowspan: 1, colwidth: null, align: null }, [
    node('paragraph', { synthetic: true }, inline),
  ])
}

function block(n: any, warn: Warning[]): PMNode[] {
  switch (n.type) {
    case 'yaml':
      return [node('frontMatter', { value: n.value })]
    case 'paragraph':
      return [
        node(
          'paragraph',
          { directiveLabel: n.data?.directiveLabel ? true : null, synthetic: null },
          inlineNodes(n.children, [], warn),
        ),
      ]
    case 'heading':
      return [node('heading', { level: n.depth }, inlineNodes(n.children, [], warn))]
    case 'blockquote':
      return [node('blockquote', null, blocks(n.children, warn))]
    case 'list': {
      const kind = listKind(n)
      const attrs: Record<string, unknown> = { spread: n.spread ?? null }
      if (kind === 'orderedList') {
        attrs.start = n.start ?? 1
        attrs.type = null
      }
      return [
        node(
          kind,
          attrs,
          (n.children ?? []).map((i: any) => listItem(i, kind, warn)),
        ),
      ]
    }
    case 'code':
      return [
        node(
          'codeBlock',
          { language: n.lang ?? null, meta: n.meta ?? null },
          text(n.value ?? '', []),
        ),
      ]
    case 'thematicBreak':
      return [node('horizontalRule', null)]
    case 'html':
      return [node('htmlBlock', null, text(n.value ?? '', []))]
    case 'table': {
      const rows = (n.children ?? []).map((row: any, index: number) =>
        node(
          'tableRow',
          null,
          (row.children ?? []).map((cell: any) =>
            tableCell(cell, index === 0 ? 'tableHeader' : 'tableCell', warn),
          ),
        ),
      )
      return [node('table', { align: n.align ?? null }, rows)]
    }
    case 'containerDirective':
      return [
        node(
          'containerDirective',
          { name: n.name, attributes: n.attributes ?? {} },
          blocks(n.children, warn),
        ),
      ]
    case 'leafDirective':
      return [
        node(
          'leafDirective',
          { name: n.name, attributes: n.attributes ?? {} },
          inlineNodes(n.children, [], warn),
        ),
      ]
    case 'definition':
      return [
        node('definition', {
          identifier: n.identifier,
          label: n.label ?? null,
          url: n.url,
          title: n.title ?? null,
        }),
      ]
    case 'footnoteDefinition':
      return [
        node(
          'footnoteDefinition',
          { identifier: n.identifier, label: n.label ?? null },
          blocks(n.children, warn),
        ),
      ]
    default:
      warn.push({ code: 'unsupported-block', detail: n.type })
      return [
        node('rawMdast', {
          node: JSON.parse(JSON.stringify(n, (k, v) => (k === 'position' ? undefined : v))),
        }),
      ]
  }
}

export function mdastToProseMirror(tree: any): { doc: PMNode; warnings: Warning[] } {
  const warnings: Warning[] = []
  let content = blocks(tree.children, warnings)
  if (content.length === 0) content = [node('paragraph', null)]
  const doc = schema.nodes.doc.create(null, content)
  doc.check()
  return { doc, warnings }
}
