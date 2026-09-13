import type { Mark, Node as PMNode } from 'prosemirror-model'
import type {
  BlockContent,
  DefinitionContent,
  ListItem,
  PhrasingContent,
  Root,
  RootContent,
  TableCell,
  TableRow,
} from 'mdast'

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
        return { type: 'break' }
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
        return { type: 'strong', children: kids }
      case 'italic':
        return { type: 'emphasis', children: kids }
      case 'strike':
        return { type: 'delete', children: kids }
      case 'code':
        return { type: 'inlineCode', value: textOf(kids) }
      default:
        return attrs['referenceType'] === null
          ? { type: 'link', url: attrs['href'], title: attrs['title'], children: kids }
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
    return { type: 'tableRow', children: children(row).map((cell) => tableCell(cell)) }
  }

  function listItem(item: PMNode): ListItem {
    return {
      type: 'listItem',
      spread: item.attrs['spread'] === true,
      checked:
        item.type.name === 'taskItem' ? item.attrs['checked'] === true : item.attrs['checked'],
      children: itemChildren(item),
    }
  }

  function block(node: PMNode): BlockNode[] {
    const { attrs } = node
    switch (node.type.name) {
      case 'paragraph': {
        const paragraph: BlockNode = { type: 'paragraph', children: inlines(children(node), []) }
        return [
          attrs['directiveLabel'] === true
            ? { ...paragraph, data: { directiveLabel: true } }
            : paragraph,
        ]
      }
      case 'heading':
        return [{ type: 'heading', depth: attrs['level'], children: inlines(children(node), []) }]
      case 'blockquote':
        return [{ type: 'blockquote', children: blocks(children(node)) }]
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
          },
        ]
      }
      case 'codeBlock':
        return [
          { type: 'code', lang: attrs['language'], meta: attrs['meta'], value: node.textContent },
        ]
      case 'horizontalRule':
        return [{ type: 'thematicBreak' }]
      case 'htmlBlock':
        return [{ type: 'html', value: node.textContent }]
      case 'table':
        return [
          {
            type: 'table',
            align: attrs['align'],
            children: children(node).map((row) => tableRow(row)),
          },
        ]
      case 'containerDirective':
        return [
          {
            type: 'containerDirective',
            name: attrs['name'],
            attributes: attrs['attributes'],
            children: blocks(children(node)),
          },
        ]
      case 'leafDirective':
        return [
          {
            type: 'leafDirective',
            name: attrs['name'],
            attributes: attrs['attributes'],
            children: inlines(children(node), []),
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
