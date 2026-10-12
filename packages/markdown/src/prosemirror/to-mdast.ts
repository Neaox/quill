import type { Mark, Node as PMNode } from 'prosemirror-model'
import type {
  BlockContent,
  Code,
  DefinitionContent,
  ListItem,
  Paragraph,
  PhrasingContent,
  Root,
  RootContent,
  TableCell,
  TableRow,
} from 'mdast'

import { DETAILS } from '../details/details.ts'
import type { CalloutType } from '../directives/callout.ts'
import { isCalloutType } from '../directives/callout.ts'
import { markerFor, markerType } from '../pipeline/github-alert.ts'
import type { AlertForm } from '../pipeline/github-alert.ts'
import type { SourceForm } from '../pipeline/source-form.ts'
import type { Warning } from '../warnings.ts'
import { warning } from '../warnings.ts'

/**
 * Outermost first. `code` is last because mdast's `inlineCode` is a leaf: nothing
 * can nest inside it. ProseMirror marks are a set rather than a tree, so nesting
 * order is not recoverable and this fixed order is used instead; the two orders
 * render identically (research R3 section 8).
 */
const MARK_ORDER = ['link', 'bold', 'italic', 'strike', 'code'] as const

/** What a block may hold inside a blockquote, a list item, or a container directive. */
type BlockNode = BlockContent | DefinitionContent

export interface MdastDocument {
  readonly tree: Root
  readonly warnings: readonly Warning[]
}

/** The mark a run of inline nodes is about to be wrapped in. */
interface AppliedMark {
  readonly name: string
  readonly mark: Mark
}

interface MarkRun {
  readonly applied: AppliedMark | undefined
  readonly nodes: PMNode[]
}

/** How a callout is written as a quote, and what its first block is if it is a title. */
interface AlertWriting extends AlertForm {
  readonly type: CalloutType
}

/**
 * How a callout is written as a quote (GitHub's alert, Obsidian's callout), when it
 * was read from one or made in the editor, and is still a callout of a known type
 * with nothing else to say. The quote is the standard form wherever one exists, so
 * the title Obsidian puts after the marker and the kinds it has are written as it
 * writes them; the directive is for a callout that was written as one.
 */
function alertFormOf(node: PMNode): AlertWriting | undefined {
  const { attrs } = node
  const form: unknown = attrs['alert']
  const attributes: unknown = attrs['attributes']
  if (attrs['name'] !== 'callout' || typeof form !== 'object' || form === null) return undefined
  if (typeof attributes !== 'object' || attributes === null) return undefined
  if (!('marker' in form) || typeof form.marker !== 'string') return undefined
  const entries = Object.entries(attributes)
  const type = entries.length === 1 ? entries[0]?.[1] : undefined
  if (typeof type !== 'string' || !isCalloutType(type)) return undefined
  return { marker: form.marker, own: 'own' in form && form.own === true, type }
}

/** The title a callout's first block is, and the body that follows it. */
function titleAndBody(body: readonly BlockNode[]): {
  readonly title: PhrasingContent[]
  readonly rest: readonly BlockNode[]
} {
  const [first, ...rest] = body
  return first?.type === 'paragraph' && first.data?.directiveLabel === true
    ? { title: first.children, rest }
    : { title: [], rest: body }
}

/** Text nodes that touch are one: what the parser would have read the written text as. */
function joinText(inline: readonly PhrasingContent[]): PhrasingContent[] {
  return inline.reduce<PhrasingContent[]>((joined, node) => {
    const last = joined.at(-1)
    return last?.type === 'text' && node.type === 'text'
      ? [...joined.slice(0, -1), { ...last, value: last.value + node.value }]
      : [...joined, node]
  }, [])
}

/** A callout as the quote it was: its marker and title on a line, then its blocks. */
function alertBlockquote(
  form: AlertWriting,
  body: readonly BlockNode[],
  data: ReturnType<typeof dataOf>,
): BlockContent {
  // A type that was changed in the editor is written as the type it is now.
  const marker =
    markerType(form.marker) === form.type ? form.marker : markerFor(form.type, form.marker)
  const { title, rest } = titleAndBody(body)
  const line: PhrasingContent[] = [
    { type: 'text', value: title.length === 0 ? marker : `${marker} ` },
    ...title,
  ]
  const [first, ...others] = rest
  const blocks: BlockNode[] =
    !form.own && first?.type === 'paragraph'
      ? [
          {
            ...first,
            children: joinText([...line, { type: 'text', value: '\n' }, ...first.children]),
          },
          ...others,
        ]
      : [{ type: 'paragraph', children: joinText(line) }, ...rest]
  return { type: 'blockquote', children: blocks, ...data }
}

function children(node: PMNode): PMNode[] {
  const out: PMNode[] = []
  node.forEach((child) => out.push(child))
  return out
}

function textOf(nodes: readonly PhrasingContent[]): string {
  return nodes.map((node) => ('value' in node ? node.value : '')).join('')
}

function pendingMark(node: PMNode, active: readonly string[]): AppliedMark | undefined {
  for (const name of MARK_ORDER) {
    if (active.includes(name)) continue
    const mark = node.marks.find((candidate) => candidate.type.name === name)
    if (mark !== undefined) return { name, mark }
  }
  return undefined
}

/**
 * A run extends for as long as the following nodes carry the mark it opened with,
 * not for as long as they would open the same mark themselves. The difference
 * matters for `*italic with **bold** inside*`: the middle node carries both marks,
 * and only the first rule keeps the emphasis whole.
 */
function continuesRun(
  applied: AppliedMark | undefined,
  node: PMNode,
  active: readonly string[],
): boolean {
  if (applied === undefined) return pendingMark(node, active) === undefined
  return node.marks.some((candidate) => candidate.eq(applied.mark))
}

/** Groups adjacent inline nodes that one mark will wrap. */
function markRuns(nodes: readonly PMNode[], active: readonly string[]): MarkRun[] {
  const runs: MarkRun[] = []
  for (const node of nodes) {
    const last = runs.at(-1)
    if (last !== undefined && continuesRun(last.applied, node, active)) {
      last.nodes.push(node)
      continue
    }
    runs.push({ applied: pendingMark(node, active), nodes: [node] })
  }
  return runs
}

/** How the node was written, carried back to mdast for the writer (`pipeline/source-form.ts`). */
function dataOf(node: PMNode | Mark): { data?: { sourceForm: SourceForm } } {
  const sourceForm: SourceForm | null = node.attrs['sourceForm']
  return sourceForm === null ? {} : { data: { sourceForm } }
}

function isSyntheticParagraph(node: PMNode): boolean {
  return (
    node.type.name === 'paragraph' && node.attrs['synthetic'] === true && node.content.size === 0
  )
}

/**
 * A ProseMirror document back to mdast (ADR-003). The Markdown string is never
 * produced from the ProseMirror document directly: mdast is always in the middle,
 * so the serialisation profile applies to editor output and to imported files
 * alike (ADR-004). A node type this converter does not know degrades to its text
 * with a warning rather than throwing.
 */
export function proseMirrorToMdast(doc: PMNode): MdastDocument {
  const warnings: Warning[] = []

  function leaf(node: PMNode): PhrasingContent {
    switch (node.type.name) {
      case 'text':
        return { type: 'text', value: node.textContent }
      case 'hardBreak':
        return { type: 'break', ...dataOf(node) }
      case 'htmlInline':
        return { type: 'html', value: node.attrs['value'] }
      case 'image':
        return node.attrs['referenceType'] === null
          ? {
              type: 'image',
              url: node.attrs['src'],
              alt: node.attrs['alt'],
              title: node.attrs['title'],
            }
          : {
              type: 'imageReference',
              alt: node.attrs['alt'],
              identifier: node.attrs['identifier'],
              label: node.attrs['label'],
              referenceType: node.attrs['referenceType'],
            }
      case 'footnoteReference':
        return {
          type: 'footnoteReference',
          identifier: node.attrs['identifier'],
          label: node.attrs['label'],
        }
      case 'textDirective':
        return {
          type: 'textDirective',
          name: node.attrs['name'],
          attributes: node.attrs['attributes'],
          children: inlines(children(node), []),
          ...dataOf(node),
        }
      default:
        warnings.push(warning('unknown-inline-node', node.type.name))
        return { type: 'text', value: node.textContent }
    }
  }

  function wrap(applied: AppliedMark, kids: PhrasingContent[]): PhrasingContent {
    const { attrs } = applied.mark
    switch (applied.name) {
      case 'bold':
        return { type: 'strong', children: kids, ...dataOf(applied.mark) }
      case 'italic':
        return { type: 'emphasis', children: kids, ...dataOf(applied.mark) }
      case 'strike':
        return { type: 'delete', children: kids }
      case 'code':
        return { type: 'inlineCode', value: textOf(kids) }
      default:
        return attrs['referenceType'] === null
          ? {
              type: 'link',
              url: attrs['href'],
              title: attrs['title'],
              children: kids,
              ...(attrs['literal'] === true ? { data: { autolinkLiteral: true } } : {}),
            }
          : {
              type: 'linkReference',
              identifier: attrs['identifier'],
              label: attrs['label'],
              referenceType: attrs['referenceType'],
              children: kids,
            }
    }
  }

  function inlines(nodes: readonly PMNode[], active: readonly string[]): PhrasingContent[] {
    return markRuns(nodes, active).flatMap((run) =>
      run.applied === undefined
        ? run.nodes.map((node) => leaf(node))
        : [wrap(run.applied, inlines(run.nodes, [...active, run.applied.name]))],
    )
  }

  const blocks = (nodes: readonly PMNode[]): BlockNode[] => nodes.flatMap((node) => block(node))

  /** Drops the paragraph the forward converter invented to satisfy a content expression. */
  function itemChildren(item: PMNode): BlockNode[] {
    const kids = children(item)
    const head = kids.slice(0, 1)
    const tail = kids.slice(1)
    const drop = tail.length > 0 && head.every((kid) => isSyntheticParagraph(kid))
    return blocks(drop ? tail : kids)
  }

  function tableCell(cell: PMNode): TableCell {
    const kids = children(cell)
    const paragraphs = kids.filter((kid) => kid.type.name === 'paragraph')
    if (kids.length === 1 && paragraphs.length === 1) {
      return {
        type: 'tableCell',
        children: paragraphs.flatMap((paragraph) => inlines(children(paragraph), [])),
      }
    }
    // GFM cannot express a cell of several blocks. The editor prevents this rather
    // than the serialiser repairing it, so reaching here is worth saying out loud.
    warnings.push(warning('table-cell-flattened', `${kids.length} blocks`))
    return { type: 'tableCell', children: [{ type: 'text', value: cell.textContent }] }
  }

  function tableRow(row: PMNode): TableRow {
    return {
      type: 'tableRow',
      children: children(row).map((cell) => tableCell(cell)),
      ...dataOf(row),
    }
  }

  function listItem(item: PMNode): ListItem {
    return {
      type: 'listItem',
      spread: item.attrs['spread'] === true,
      checked:
        item.type.name === 'taskItem' ? item.attrs['checked'] === true : item.attrs['checked'],
      children: itemChildren(item),
      ...dataOf(item),
    }
  }

  function code(node: PMNode): Code {
    const { attrs } = node
    return {
      type: 'code',
      lang: attrs['language'],
      meta: attrs['meta'],
      value: node.textContent,
      ...dataOf(node),
    }
  }

  /**
   * A details, in the syntax it was read in (ADR-048): GitHub's HTML and
   * Obsidian's callouts are `details` nodes, written back as they were while
   * they can still say everything (`details/write.ts`); the rest is
   * `:::details`. An empty summary is no label at all.
   */
  function details(node: PMNode): BlockNode {
    const { attrs } = node
    const [summary, ...body] = children(node)
    const title = summary === undefined ? [] : inlines(children(summary), [])
    const label: Paragraph[] =
      title.length === 0
        ? []
        : [{ type: 'paragraph', data: { directiveLabel: true }, children: title }]
    const content = [...label, ...blocks(body.filter((kid) => !isSyntheticParagraph(kid)))]
    const syntax = attrs['syntax']
    if (syntax === 'html' || syntax === 'callout') {
      return {
        type: 'details',
        syntax,
        attributes: attrs['attributes'],
        ...(attrs['source'] === null ? {} : { source: attrs['source'] }),
        children: content,
        ...dataOf(node),
      }
    }
    return {
      type: 'containerDirective',
      name: DETAILS,
      attributes: attrs['attributes'],
      children: content,
      ...dataOf(node),
    }
  }

  function block(node: PMNode): BlockNode[] {
    const { attrs } = node
    switch (node.type.name) {
      case 'paragraph': {
        const { data } = dataOf(node)
        const label = attrs['directiveLabel'] === true ? { directiveLabel: true } : {}
        const paragraph: BlockNode = { type: 'paragraph', children: inlines(children(node), []) }
        return [
          data === undefined && label.directiveLabel === undefined
            ? paragraph
            : { ...paragraph, data: { ...data, ...label } },
        ]
      }
      case 'heading':
        return [
          {
            type: 'heading',
            depth: attrs['level'],
            children: inlines(children(node), []),
            ...dataOf(node),
          },
        ]
      case 'blockquote':
        return [{ type: 'blockquote', children: blocks(children(node)), ...dataOf(node) }]
      case 'bulletList':
      case 'taskList':
      case 'orderedList': {
        const ordered = node.type.name === 'orderedList'
        return [
          {
            type: 'list',
            ordered,
            start: ordered ? attrs['start'] : null,
            spread: attrs['spread'] === true,
            children: children(node).map((item) => listItem(item)),
            ...dataOf(node),
          },
        ]
      }
      case 'codeBlock':
        return [code(node)]
      case 'codeGroup':
        return [
          {
            type: 'codeGroup',
            syntax: attrs['syntax'],
            attributes: attrs['attributes'],
            spread: attrs['spread'] === true,
            ...(typeof attrs['opening'] === 'string' ? { opening: attrs['opening'] } : {}),
            children: children(node).map((tab) => code(tab)),
          },
        ]
      case 'horizontalRule':
        return [{ type: 'thematicBreak', ...dataOf(node) }]
      case 'htmlBlock':
        return [{ type: 'html', value: node.textContent, ...dataOf(node) }]
      case 'table':
        return [
          {
            type: 'table',
            align: attrs['align'],
            children: children(node).map((row) => tableRow(row)),
            ...dataOf(node),
          },
        ]
      case 'details':
        return [details(node)]
      case 'containerDirective': {
        // The line an empty container holds only because it must is not written.
        const content = blocks(children(node).filter((kid) => !isSyntheticParagraph(kid)))
        const alert = alertFormOf(node)
        if (alert !== undefined) return [alertBlockquote(alert, content, dataOf(node))]
        return [
          {
            type: 'containerDirective',
            name: attrs['name'],
            attributes: attrs['attributes'],
            children: content,
            ...dataOf(node),
          },
        ]
      }
      case 'leafDirective':
        return [
          {
            type: 'leafDirective',
            name: attrs['name'],
            attributes: attrs['attributes'],
            children: inlines(children(node), []),
            ...dataOf(node),
          },
        ]
      case 'definition':
        return [
          {
            type: 'definition',
            identifier: attrs['identifier'],
            label: attrs['label'],
            url: attrs['url'],
            title: attrs['title'],
          },
        ]
      case 'footnoteDefinition':
        return [
          {
            type: 'footnoteDefinition',
            identifier: attrs['identifier'],
            label: attrs['label'],
            children: blocks(children(node)),
            ...dataOf(node),
          },
        ]
      case 'rawMdast':
        return [attrs['node']]
      default:
        warnings.push(warning('unknown-block-node', node.type.name))
        return [{ type: 'paragraph', children: [{ type: 'text', value: node.textContent }] }]
    }
  }

  /** Front matter exists only at the top of a file, so it is mapped only there. */
  const rootChildren = (nodes: readonly PMNode[]): RootContent[] =>
    nodes.flatMap<RootContent>((node) =>
      node.type.name === 'frontMatter'
        ? [{ type: 'yaml', value: node.attrs['value'] }]
        : block(node),
    )

  return { tree: { type: 'root', children: rootChildren(children(doc)) }, warnings }
}
