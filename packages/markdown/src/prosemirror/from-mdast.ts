import { toString } from 'mdast-util-to-string'
import type { Mark, Node as PMNode } from 'prosemirror-model'
import type { List, ListItem, PhrasingContent, Root, RootContent, TableRow } from 'mdast'

import type { Warning } from '../warnings.ts'
import { warning } from '../warnings.ts'
import { schema } from './schema.ts'

/**
 * A paragraph wrapped in the source survives mdast and survives this converter,
 * but not a live editor: the newline is invisible in the DOM and the first edit
 * destroys it. `collapse` models the editor, and is what the first publish from
 * the editor does, once, as a formatting-only change (ADR-002).
 */
export type SoftBreakMode = 'preserve' | 'collapse'

export interface FromMdastOptions {
  readonly softBreaks?: SoftBreakMode
}

export interface ProseMirrorDocument {
  readonly doc: PMNode
  readonly warnings: readonly Warning[]
}

type Attributes = Record<string, unknown>

function node(name: string, attrs: Attributes | null, content: readonly PMNode[] = []): PMNode {
  return schema.node(name, attrs, content)
}

function text(value: string, marks: readonly Mark[]): PMNode[] {
  return value.length > 0 ? [schema.text(value, marks)] : []
}

// `addToSet` rather than a plain append: nested emphasis of the same kind must not
// produce a text node carrying the same mark twice, which `check()` rejects.
function withMark(marks: readonly Mark[], name: string, attrs?: Attributes): readonly Mark[] {
  return schema.mark(name, attrs).addToSet(marks)
}

function listKind(list: List): 'orderedList' | 'taskList' | 'bulletList' {
  if (list.ordered === true) return 'orderedList'
  const every = list.children.every((item) => item.checked === true || item.checked === false)
  return list.children.length > 0 && every ? 'taskList' : 'bulletList'
}

/**
 * mdast to a ProseMirror document (ADR-003). Every mdast node type the schema
 * models has a case here; anything else is carried unchanged on the `rawMdast`
 * escape hatch rather than throwing (AGENTS.md rule 7).
 */
export function mdastToProseMirror(
  tree: Root,
  options: FromMdastOptions = {},
): ProseMirrorDocument {
  const softBreaks = options.softBreaks ?? 'preserve'
  const warnings: Warning[] = []

  const inlines = (children: readonly PhrasingContent[], marks: readonly Mark[]): PMNode[] =>
    children.flatMap((child) => inline(child, marks))

  function inline(current: PhrasingContent, marks: readonly Mark[]): PMNode[] {
    switch (current.type) {
      case 'text':
        return text(
          softBreaks === 'collapse' ? current.value.replaceAll('\n', ' ') : current.value,
          marks,
        )
      case 'emphasis':
        return inlines(current.children, withMark(marks, 'italic'))
      case 'strong':
        return inlines(current.children, withMark(marks, 'bold'))
      case 'delete':
        return inlines(current.children, withMark(marks, 'strike'))
      case 'inlineCode':
        return text(current.value, withMark(marks, 'code'))
      case 'break':
        return [node('hardBreak', null).mark(marks)]
      case 'link':
        return inlines(
          current.children,
          withMark(marks, 'link', { href: current.url, title: current.title }),
        )
      case 'linkReference':
        return inlines(
          current.children,
          withMark(marks, 'link', {
            referenceType: current.referenceType,
            identifier: current.identifier,
            label: current.label,
          }),
        )
      case 'image':
        return [
          node('image', {
            src: current.url,
            alt: current.alt,
            title: current.title,
          }).mark(marks),
        ]
      case 'imageReference':
        return [
          node('image', {
            alt: current.alt,
            referenceType: current.referenceType,
            identifier: current.identifier,
            label: current.label,
          }).mark(marks),
        ]
      case 'html':
        return [node('htmlInline', { value: current.value }).mark(marks)]
      case 'footnoteReference':
        return [
          node('footnoteReference', {
            identifier: current.identifier,
            label: current.label,
          }).mark(marks),
        ]
      case 'textDirective':
        return [
          node(
            'textDirective',
            { name: current.name, attributes: current.attributes },
            inlines(current.children, []),
          ).mark(marks),
        ]
      case 'rawMdast':
        return text(current.value, marks)
      default: {
        const unmodelled: { readonly type: string } = current
        warnings.push(warning('unsupported-inline', unmodelled.type))
        return text(toString(unmodelled), marks)
      }
    }
  }

  const blocks = (children: readonly RootContent[]): PMNode[] =>
    children.flatMap((child) => block(child))

  function listItem(item: ListItem, kind: string): PMNode {
    const content = blocks(item.children)
    const body =
      content[0]?.type.name === 'paragraph'
        ? content
        : [node('paragraph', { synthetic: true }), ...content]
    if (kind === 'taskList') {
      return node('taskItem', { checked: item.checked === true, spread: item.spread }, body)
    }
    return node('listItem', { checked: item.checked, spread: item.spread }, body)
  }

  function tableRow(row: TableRow, header: boolean): PMNode {
    const cells = row.children.map((cell) =>
      node(header ? 'tableHeader' : 'tableCell', null, [
        node('paragraph', { synthetic: true }, inlines(cell.children, [])),
      ]),
    )
    return node('tableRow', null, cells)
  }

  function block(current: RootContent): PMNode[] {
    switch (current.type) {
      case 'yaml':
        return [node('frontMatter', { value: current.value })]
      case 'paragraph':
        return [
          node(
            'paragraph',
            { directiveLabel: current.data?.directiveLabel },
            inlines(current.children, []),
          ),
        ]
      case 'heading':
        return [node('heading', { level: current.depth }, inlines(current.children, []))]
      case 'blockquote':
        return [node('blockquote', null, blocks(current.children))]
      case 'list': {
        const kind = listKind(current)
        const attrs: Attributes = { spread: current.spread }
        if (kind === 'orderedList') attrs['start'] = current.start
        return [
          node(
            kind,
            attrs,
            current.children.map((item) => listItem(item, kind)),
          ),
        ]
      }
      case 'code':
        return [
          node(
            'codeBlock',
            { language: current.lang, meta: current.meta },
            text(current.value, []),
          ),
        ]
      case 'thematicBreak':
        return [node('horizontalRule', null)]
      case 'html':
        return [node('htmlBlock', null, text(current.value, []))]
      case 'table':
        return [
          node(
            'table',
            { align: current.align },
            current.children.map((row, index) => tableRow(row, index === 0)),
          ),
        ]
      case 'containerDirective':
        return [
          node(
            'containerDirective',
            { name: current.name, attributes: current.attributes },
            blocks(current.children),
          ),
        ]
      case 'leafDirective':
        return [
          node(
            'leafDirective',
            { name: current.name, attributes: current.attributes },
            inlines(current.children, []),
          ),
        ]
      case 'definition':
        return [
          node('definition', {
            identifier: current.identifier,
            label: current.label,
            url: current.url,
            title: current.title,
          }),
        ]
      case 'footnoteDefinition':
        return [
          node(
            'footnoteDefinition',
            { identifier: current.identifier, label: current.label },
            blocks(current.children),
          ),
        ]
      case 'rawMdast':
        // Already on the escape hatch, so it is carried across rather than
        // reported: an earlier parse put it there deliberately and the editor
        // holds it unchanged. Only an inline one becomes text (see `inline`).
        return [node('rawMdast', { node: withoutPosition(current) })]
      default:
        warnings.push(warning('unsupported-block', current.type))
        return [node('rawMdast', { node: withoutPosition(current) })]
    }
  }

  const content = blocks(tree.children)
  const doc = schema.node('doc', null, content.length > 0 ? content : [node('paragraph', null)])
  doc.check()
  return { doc, warnings }
}

/** Byte offsets are not content; they would make an editor round trip look lossy. */
function withoutPosition(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (key: string, inner: unknown) =>
      key === 'position' ? undefined : inner,
    ),
  )
}
