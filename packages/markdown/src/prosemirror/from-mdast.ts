import { toString } from 'mdast-util-to-string'
import type { Mark, Node as PMNode } from 'prosemirror-model'
import type {
  Blockquote,
  Code,
  List,
  ListItem,
  PhrasingContent,
  Root,
  RootContent,
  TableRow,
} from 'mdast'

import type { DetailsNode } from '../details/details.ts'
import { DETAILS, detailsModel, isDetails } from '../details/details.ts'
import type { SourceForm } from '../pipeline/source-form.ts'
import type { Warning } from '../warnings.ts'
import { warning } from '../warnings.ts'
import { readAlert } from './alert.ts'
import { schema } from './schema.ts'
import { collapseSoftBreaks } from './soft-breaks.ts'

/**
 * A paragraph wrapped in the source survives mdast and survives this converter,
 * but not a live editor, which keeps whitespace and so would show the newline
 * as a line break the reader never sees. `collapse` is what the editor opens a
 * document with, and so what the first publish from the editor writes, once,
 * as a formatting-only change (ADR-002); `preserve` keeps the tree as it came.
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

/** How the node was written, where mdast does not say (`pipeline/source-form.ts`). */
function formOf(written: {
  readonly data?: { readonly sourceForm?: SourceForm | undefined } | undefined
}): {
  readonly sourceForm: SourceForm | null
} {
  return { sourceForm: written.data?.sourceForm ?? null }
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
  const warnings: Warning[] = []

  const inlines = (children: readonly PhrasingContent[], marks: readonly Mark[]): PMNode[] =>
    children.flatMap((child) => inline(child, marks))

  function inline(current: PhrasingContent, marks: readonly Mark[]): PMNode[] {
    switch (current.type) {
      case 'text':
        return text(current.value, marks)
      case 'emphasis':
        return inlines(current.children, withMark(marks, 'italic', formOf(current)))
      case 'strong':
        return inlines(current.children, withMark(marks, 'bold', formOf(current)))
      case 'delete':
        return inlines(current.children, withMark(marks, 'strike'))
      case 'inlineCode':
        return text(current.value, withMark(marks, 'code'))
      case 'break':
        return [node('hardBreak', formOf(current)).mark(marks)]
      case 'link':
        return inlines(
          current.children,
          withMark(marks, 'link', {
            href: current.url,
            title: current.title,
            literal: current.data?.autolinkLiteral === true ? true : null,
          }),
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
            { name: current.name, attributes: current.attributes, ...formOf(current) },
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
      return node(
        'taskItem',
        { checked: item.checked === true, spread: item.spread, ...formOf(item) },
        body,
      )
    }
    return node('listItem', { checked: item.checked, spread: item.spread, ...formOf(item) }, body)
  }

  function tableRow(row: TableRow, header: boolean): PMNode {
    const cells = row.children.map((cell) =>
      node(header ? 'tableHeader' : 'tableCell', null, [
        node('paragraph', { synthetic: true }, inlines(cell.children, [])),
      ]),
    )
    return node('tableRow', formOf(row), cells)
  }

  function codeBlock(code: Code): PMNode {
    return node(
      'codeBlock',
      { language: code.lang, meta: code.meta, ...formOf(code) },
      text(code.value, []),
    )
  }

  /**
   * A details in any syntax (ADR-048): its summary line and its body, which
   * must hold a block, so an empty one holds the synthetic paragraph that is
   * written back as nothing.
   */
  function details(current: DetailsNode): PMNode {
    const model = detailsModel(current)
    const body = blocks(model.body)
    return node(
      'details',
      {
        syntax: isDetails(current) ? current.syntax : 'directive',
        attributes: current.attributes ?? {},
        source: isDetails(current) ? (current.source ?? null) : null,
        ...formOf(current),
      },
      [
        node('detailsSummary', null, inlines(model.summary?.children ?? [], [])),
        ...(body.length === 0 ? [node('paragraph', { synthetic: true })] : body),
      ],
    )
  }

  /**
   * A quote, and a GitHub alert as a quote that knows it is one, its marker
   * line carried on the node rather than in its text (`alert.ts`). An alert
   * with nothing but its marker holds the synthetic paragraph.
   */
  function blockquote(current: Blockquote): PMNode {
    const alert = readAlert(current)
    if (alert === undefined) return node('blockquote', formOf(current), blocks(current.children))
    const content = blocks(alert.children)
    return node(
      'blockquote',
      { alert: alert.form, ...formOf(current) },
      content.length === 0 ? [node('paragraph', { synthetic: true })] : content,
    )
  }

  function block(current: RootContent): PMNode[] {
    switch (current.type) {
      case 'yaml':
        return [node('frontMatter', { value: current.value })]
      case 'paragraph':
        return [
          node(
            'paragraph',
            { directiveLabel: current.data?.directiveLabel, ...formOf(current) },
            inlines(current.children, []),
          ),
        ]
      case 'heading':
        return [
          node(
            'heading',
            { level: current.depth, ...formOf(current) },
            inlines(current.children, []),
          ),
        ]
      case 'blockquote':
        return [blockquote(current)]
      case 'list': {
        const kind = listKind(current)
        const attrs: Attributes = { spread: current.spread, ...formOf(current) }
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
        return [codeBlock(current)]
      case 'codeGroup':
        return [
          node(
            'codeGroup',
            {
              syntax: current.syntax,
              attributes: current.attributes,
              spread: current.spread,
              opening: current.opening,
            },
            current.children.map((code) => codeBlock(code)),
          ),
        ]
      case 'thematicBreak':
        return [node('horizontalRule', formOf(current))]
      case 'html':
        return [node('htmlBlock', formOf(current), text(current.value, []))]
      case 'table':
        return [
          node(
            'table',
            { align: current.align, ...formOf(current) },
            current.children.map((row, index) => tableRow(row, index === 0)),
          ),
        ]
      case 'details':
        return [details(current)]
      case 'containerDirective': {
        if (current.name === DETAILS) return [details(current)]
        // `:::callout` with nothing in it is valid Markdown — it is what an
        // emptied callout is written as — but the node must hold a block, so
        // it holds the synthetic paragraph, which is written back as nothing.
        const content = blocks(current.children)
        return [
          node(
            'containerDirective',
            { name: current.name, attributes: current.attributes, ...formOf(current) },
            content.length === 0 ? [node('paragraph', { synthetic: true })] : content,
          ),
        ]
      }
      case 'leafDirective':
        return [
          node(
            'leafDirective',
            { name: current.name, attributes: current.attributes, ...formOf(current) },
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
            { identifier: current.identifier, label: current.label, ...formOf(current) },
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

  const source = options.softBreaks === 'collapse' ? collapseSoftBreaks(tree) : tree
  const content = blocks(source.children)
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
