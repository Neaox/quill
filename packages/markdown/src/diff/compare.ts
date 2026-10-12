import type {
  BlockContent,
  Code,
  DefinitionContent,
  List,
  ListItem,
  Nodes,
  Paragraph,
  PhrasingContent,
  Root,
  RootContent,
  Table,
  TableCell,
  TableRow,
} from 'mdast'
import { visit } from 'unist-util-visit'

import { calloutDirective, isCalloutType } from '../directives/callout.ts'
import { claims } from '../directives/definition.ts'
import { isPresenterNotes, stripPresenterNotes } from '../directives/strip-presenter-notes.ts'
import { DIAGRAM_LANGUAGES } from '../render/handlers.ts'
import type { BlockAlignment } from './blocks.ts'
import { alignBlocks } from './blocks.ts'
import { hasChanges, mergePhrasing, wholly } from './inline.ts'
import { plainText } from './text.ts'
import type { BlockChange, BlockMark, DiffCode } from './nodes.ts'
import { marked } from './nodes.ts'
import { wordCount, tokenize } from './runs.ts'
import { compareLines } from './lines.ts'

/**
 * Two revisions of a document as one tree a reader can follow: the newer
 * document, with what the older one had and this one does not put back where
 * it was, and every difference marked.
 *
 * - **Blocks** are matched first (`blocks.ts`): unchanged, added, removed,
 *   changed, or moved.
 * - **Inside a changed block**, the comparison goes as deep as the block's
 *   own structure: words in a paragraph or heading, rows and then cells in a
 *   table, items in a list, lines in a code block, blocks inside a quote or a
 *   callout.
 * - **Pictures** — an image, a diagram — and anything else whose parts are
 *   not words are shown **before and after**, side by side in the reading
 *   order, because a struck-through picture tells nobody what changed.
 *
 * Presenter notes are left out on both sides, as the reader's page leaves
 * them out. The result is drawn by `renderComparison` through the reader's
 * own renderer, and its list of changes is what the comparison view's
 * summary, change list and next/previous are built from.
 */

/** A top-level block a reader can point at. */
type Flow = BlockContent | DefinitionContent

/** What sort of block changed, for the list of changes. */
export type ChangedBlock =
  | 'heading'
  | 'paragraph'
  | 'list'
  | 'table'
  | 'code'
  | 'image'
  | 'diagram'
  | 'quote'
  | 'callout'
  | 'divider'
  | 'block'

export interface ComparedChange {
  /** Stable within this comparison: `c1`, `c2`, … in reading order. */
  readonly id: string
  readonly change: BlockChange
  readonly block: ChangedBlock
  /** The block's words, shortened: what the list of changes shows. */
  readonly excerpt: string
  readonly wordsAdded: number
  readonly wordsRemoved: number
  /** The top-level position in the comparison tree where this change starts. */
  readonly index: number
  /**
   * Where the change stands among the newer document's own top-level blocks, counted as
   * written (presenter notes included): the block's place when it is there, and for a
   * removal the place of the block that followed it, which is where it would go back.
   */
  readonly at: number
  /** The older block, as written, when the older document had one. */
  readonly previous?: RootContent | undefined
  /** What the comparison tree holds for this change: its marked blocks, in order. */
  readonly nodes: readonly RootContent[]
}

export interface DocumentComparison {
  readonly tree: Root
  readonly changes: readonly ComparedChange[]
}

const EXCERPT_LENGTH = 90

const NEWLINE = '\n'

/**
 * Whether a top-level node is a block a reader could point at: not the front matter, which
 * is compared as properties and which a draft keeps apart from its tree, and not an empty
 * paragraph, which is the editor's blank line and which no Markdown writes or reads back.
 */
function isBlock(node: RootContent): boolean {
  return node.type !== 'yaml' && !(node.type === 'paragraph' && node.children.length === 0)
}

/** A document's top-level blocks, as a comparison counts them. */
export function blocksOf(root: Root): RootContent[] {
  return root.children.filter(isBlock)
}

/** Where each of `blocksOf(root)` stands among `root.children`, which also hold what it leaves out. */
export function blockPositions(root: Root): number[] {
  return root.children.flatMap((node, index) => (isBlock(node) ? [index] : []))
}

/** A top-level block as the comparison reads it, and where it stands in the document as written. */
interface ReadBlock {
  readonly block: Flow
  readonly written: number
  readonly original: RootContent
}

/**
 * A document's blocks as the comparison reads them: presenter notes are left out, and so
 * is anything that is not flow. Each keeps the place it has in the document as written,
 * and the block as written, which is what a revert puts back.
 */
function readBlocks(root: Root): readonly ReadBlock[] {
  const body = blocksOf(root)
  const stripped = stripPresenterNotes({ ...root, children: body }).children
  const kept = body.flatMap((original, written) =>
    isPresenterNotes(original) ? [] : [{ original, written }],
  )
  return stripped.flatMap((block, index) => {
    const at = kept[index]
    return at !== undefined && isFlow(block) ? [{ block, ...at }] : []
  })
}

export function compareDocuments(before: Root, after: Root): DocumentComparison {
  const older = readBlocks(before)
  const newer = readBlocks(after)
  const oldWas = new Map(older.map(({ block, original }) => [block, original]))
  const newStands = new Map(newer.map(({ block, written }) => [block, written]))
  const alignment = alignBlocks(
    older.map(({ block }) => block),
    newer.map(({ block }) => block),
  )
  const standsAt = placesInNewer(alignment, newStands, blocksOf(after).length)

  const children: RootContent[] = []
  const changes: ComparedChange[] = []
  const draw = (
    entry: BlockAlignment<Flow>,
    index: number,
    change: BlockChange,
    merged: Merged<Flow>,
  ) => {
    const node = entry.kind === 'removed' ? entry.before : entry.after
    const id = `c${changes.length + 1}`
    changes.push({
      id,
      change,
      block: blockKind(node),
      excerpt: excerpt(node),
      wordsAdded: merged.added,
      wordsRemoved: merged.removed,
      index: children.length,
      at: standsAt[index] ?? blocksOf(after).length,
      previous: entry.kind === 'added' ? undefined : oldWas.get(entry.before),
      nodes: markFirst(merged.nodes, { change }),
    })
    children.push(...markFirst(merged.nodes, { change, id }))
  }

  for (const [index, entry] of alignment.entries()) {
    switch (entry.kind) {
      case 'unchanged':
        children.push(entry.after)
        break
      case 'added':
        draw(entry, index, 'added', {
          nodes: [wrapped(entry.after, 'added')],
          added: wordsIn(entry.after),
          removed: 0,
        })
        break
      case 'removed':
        draw(entry, index, 'removed', {
          nodes: [wrapped(entry.before, 'removed')],
          added: 0,
          removed: wordsIn(entry.before),
        })
        break
      case 'moved':
        draw(entry, index, 'moved', { nodes: [entry.after], added: 0, removed: 0 })
        break
      case 'changed':
        draw(entry, index, 'changed', mergeBlock(entry.before, entry.after))
        break
    }
  }

  return { tree: { type: 'root', children }, changes }
}

/**
 * Where each entry of an alignment stands among the newer document's blocks as written:
 * its own place when the newer document has it, and for a removal the place of the next
 * block the newer document does have, which is where the removal would go back.
 */
function placesInNewer(
  alignment: readonly BlockAlignment<Flow>[],
  stands: ReadonlyMap<Flow, number>,
  end: number,
): readonly number[] {
  const places: number[] = []
  let next = end
  for (const entry of alignment.toReversed()) {
    if (entry.kind !== 'removed') next = stands.get(entry.after) ?? next
    places.push(next)
  }
  return places.toReversed()
}

// ---------------------------------------------------------------------------
// Front matter
// ---------------------------------------------------------------------------

export interface PropertyChange {
  readonly name: string
  readonly before?: string | undefined
  readonly after?: string | undefined
}

/**
 * The document's properties that changed — title, tags, owners, status — as
 * a reader would read them. The id is the document itself, never a property
 * of it, so it is never listed.
 */
export function compareProperties(
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
): readonly PropertyChange[] {
  const names = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (name) => name !== 'id',
  )
  return names.flatMap((name): PropertyChange[] => {
    const older = readable(before[name])
    const newer = readable(after[name])
    if (older === newer) return []
    return [
      {
        name,
        ...(older === undefined ? {} : { before: older }),
        ...(newer === undefined ? {} : { after: newer }),
      },
    ]
  })
}

function readable(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (Array.isArray(value)) return value.map((item) => readable(item) ?? '').join(', ')
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

/** Every kind of node that is not flow content, which never stands at the top of a document. */
const NOT_FLOW = new Set([
  'yaml',
  'listItem',
  'tableRow',
  'tableCell',
  'text',
  'emphasis',
  'strong',
  'delete',
  'link',
  'linkReference',
  'image',
  'imageReference',
  'inlineCode',
  'break',
  'footnoteReference',
  'textDirective',
  'diffInsertion',
  'diffDeletion',
])

function isFlow(node: RootContent): node is Flow {
  return !NOT_FLOW.has(node.type)
}

interface Merged<T> {
  readonly nodes: T[]
  readonly added: number
  readonly removed: number
}

/** The first node of a change carries its id; a before-and-after pair keeps its sides. */
function markFirst<T extends Flow>(nodes: readonly T[], mark: BlockMark): T[] {
  return nodes.map((node, index) => {
    const side = node.data?.hProperties?.['data-side']
    return marked(node, {
      ...mark,
      id: index === 0 ? mark.id : undefined,
      side: side === 'before' || side === 'after' ? side : undefined,
    })
  })
}

/** Both versions of a block, one after the other, each saying which it is. */
function beforeAndAfter<T extends Flow>(before: T, after: T): Merged<T> {
  return {
    nodes: [
      marked(before, { change: 'changed', side: 'before' }),
      marked(after, { change: 'changed', side: 'after' }),
    ],
    added: wordsIn(after),
    removed: wordsIn(before),
  }
}

function mergeBlock(before: Flow, after: Flow): Merged<Flow> {
  if (isPicture(before) || isPicture(after)) return beforeAndAfter(before, after)

  if (before.type === 'paragraph' && after.type === 'paragraph') {
    const merged = mergePhrasing(before.children, after.children)
    return {
      nodes: [{ ...after, children: merged.children }],
      added: merged.wordsAdded,
      removed: merged.wordsRemoved,
    }
  }
  if (before.type === 'heading' && after.type === 'heading') {
    const merged = mergePhrasing(before.children, after.children)
    return {
      nodes: [{ ...after, children: merged.children }],
      added: merged.wordsAdded,
      removed: merged.wordsRemoved,
    }
  }
  if (before.type === 'code' && after.type === 'code' && before.lang === after.lang) {
    return mergeCode(before, after)
  }
  if (before.type === 'table' && after.type === 'table') {
    return mergeTable(before, after) ?? beforeAndAfter(before, after)
  }
  if (before.type === 'list' && after.type === 'list' && before.ordered === after.ordered) {
    const merged = mergeList(before, after)
    return { nodes: [merged.node], added: merged.added, removed: merged.removed }
  }
  if (before.type === 'blockquote' && after.type === 'blockquote') {
    const merged = mergeFlow(before.children, after.children)
    return {
      nodes: [{ ...after, children: merged.nodes }],
      added: merged.added,
      removed: merged.removed,
    }
  }
  if (
    before.type === 'containerDirective' &&
    after.type === 'containerDirective' &&
    before.name === after.name &&
    JSON.stringify(before.attributes ?? {}) === JSON.stringify(after.attributes ?? {})
  ) {
    const merged = mergeFlow(before.children, after.children)
    return {
      nodes: [{ ...after, children: merged.nodes }],
      added: merged.added,
      removed: merged.removed,
    }
  }
  if (before.type === 'details' && after.type === 'details') {
    const merged = mergeFlow(before.children, after.children)
    return {
      nodes: [{ ...after, children: merged.nodes }],
      added: merged.added,
      removed: merged.removed,
    }
  }
  return beforeAndAfter(before, after)
}

/** The children of a container, compared as blocks and marked without ids. */
function mergeFlow<T extends Flow>(before: readonly T[], after: readonly T[]): Merged<T | Flow> {
  const nodes: (T | Flow)[] = []
  let added = 0
  let removed = 0
  for (const entry of alignBlocks(before, after)) {
    switch (entry.kind) {
      case 'unchanged':
        nodes.push(entry.after)
        break
      case 'added':
        added += wordsIn(entry.after)
        nodes.push(marked(wrapped(entry.after, 'added'), { change: 'added' }))
        break
      case 'removed':
        removed += wordsIn(entry.before)
        nodes.push(marked(wrapped(entry.before, 'removed'), { change: 'removed' }))
        break
      case 'moved':
        nodes.push(marked(entry.after, { change: 'moved' }))
        break
      case 'changed': {
        const merged = mergeBlock(entry.before, entry.after)
        added += merged.added
        removed += merged.removed
        nodes.push(...markFirst(merged.nodes, { change: 'changed' }))
        break
      }
    }
  }
  return { nodes, added, removed }
}

function mergeList(before: List, after: List): { node: List; added: number; removed: number } {
  const items: ListItem[] = []
  let added = 0
  let removed = 0
  for (const entry of alignBlocks(before.children, after.children)) {
    switch (entry.kind) {
      case 'unchanged':
        items.push(entry.after)
        break
      case 'added':
        added += wordsIn(entry.after)
        items.push(marked(wrapped(entry.after, 'added'), { change: 'added' }))
        break
      case 'removed':
        removed += wordsIn(entry.before)
        items.push(marked(wrapped(entry.before, 'removed'), { change: 'removed' }))
        break
      case 'moved':
        items.push(marked(entry.after, { change: 'moved' }))
        break
      case 'changed': {
        const merged = mergeFlow(entry.before.children, entry.after.children)
        added += merged.added
        removed += merged.removed
        items.push(marked({ ...entry.after, children: merged.nodes }, { change: 'changed' }))
        break
      }
    }
  }
  return { node: { ...after, children: items }, added, removed }
}

/**
 * A table compared by row, then by cell. The header row is always the
 * header: it is compared cell by cell with the older header rather than
 * matched like a body row. A table whose columns changed is a different
 * table, and is shown before and after instead (`undefined`).
 */
function mergeTable(before: Table, after: Table): Merged<Table> | undefined {
  const width = (table: Table) => table.children[0]?.children.length ?? 0
  const [olderHead, ...olderBody] = before.children
  const [newerHead, ...newerBody] = after.children
  if (width(before) !== width(after) || olderHead === undefined || newerHead === undefined) {
    return undefined
  }

  let added = 0
  let removed = 0
  const head = mergeRow(olderHead, newerHead)
  added += head.added
  removed += head.removed
  const rows: TableRow[] = [head.row]
  for (const entry of alignBlocks(olderBody, newerBody)) {
    switch (entry.kind) {
      case 'unchanged':
        rows.push(entry.after)
        break
      case 'added':
        added += wordsIn(entry.after)
        rows.push(marked(wrapped(entry.after, 'added'), { change: 'added' }))
        break
      case 'removed':
        removed += wordsIn(entry.before)
        rows.push(marked(wrapped(entry.before, 'removed'), { change: 'removed' }))
        break
      case 'moved':
        rows.push(marked(entry.after, { change: 'moved' }))
        break
      case 'changed': {
        const merged = mergeRow(entry.before, entry.after)
        added += merged.added
        removed += merged.removed
        rows.push(merged.row)
        break
      }
    }
  }
  return { nodes: [{ ...after, children: rows }], added, removed }
}

function mergeRow(
  before: TableRow,
  after: TableRow,
): { row: TableRow; added: number; removed: number } {
  let added = 0
  let removed = 0
  let changed = false
  const cells = after.children.map((cell, index): TableCell => {
    const merged = mergePhrasing(before.children[index]?.children ?? [], cell.children)
    added += merged.wordsAdded
    removed += merged.wordsRemoved
    changed ||= hasChanges(merged.children)
    return { ...cell, children: merged.children }
  })
  const row: TableRow = { ...after, children: cells }
  return { row: changed ? marked(row, { change: 'changed' }) : row, added, removed }
}

function mergeCode(before: Code, after: Code): Merged<DiffCode> {
  const compared = compareLines(before.value.split(NEWLINE), after.value.split(NEWLINE))
  return {
    nodes: [
      {
        type: 'diffCode',
        lang: after.lang,
        lines: compared.lines,
      },
    ],
    added: compared.wordsAdded,
    removed: compared.wordsRemoved,
  }
}

function countWords(text: string): number {
  return wordCount(tokenize(text))
}

// ---------------------------------------------------------------------------
// Whole blocks
// ---------------------------------------------------------------------------

/**
 * A block only one side has, with every run of its words wrapped, so a
 * removed paragraph is struck through and announced as removed exactly as a
 * removed word is. A copy: the source trees are never changed.
 */
function wrapped<T extends Nodes>(node: T, change: 'added' | 'removed'): T {
  const copy = structuredClone(node)
  visit(copy, (child) => {
    if (child.type === 'paragraph' || child.type === 'heading' || child.type === 'tableCell') {
      child.children = wholly(change, child.children)
      return 'skip'
    }
    return undefined
  })
  return copy
}

function wordsIn(node: Nodes): number {
  return countWords(plainText(node))
}

/** A paragraph that is only a picture: an image, perhaps with a link around it. */
function isImageParagraph(node: Paragraph): boolean {
  const meaningful = (children: readonly PhrasingContent[]): PhrasingContent[] =>
    children.filter((child) => !(child.type === 'text' && child.value.trim() === ''))
  const content = meaningful(node.children)
  return (
    content.length > 0 &&
    content.every(
      (child) =>
        child.type === 'image' ||
        child.type === 'imageReference' ||
        (child.type === 'link' &&
          meaningful(child.children).every(
            (inner) => inner.type === 'image' || inner.type === 'imageReference',
          )),
    )
  )
}

function isDiagram(node: Flow): boolean {
  return node.type === 'code' && DIAGRAM_LANGUAGES.has(node.lang ?? '')
}

/** A block whose change is seen rather than read. */
function isPicture(node: Flow): boolean {
  return (
    (node.type === 'paragraph' && isImageParagraph(node)) ||
    isDiagram(node) ||
    node.type === 'leafDirective'
  )
}

function blockKind(node: Flow): ChangedBlock {
  switch (node.type) {
    case 'heading':
      return 'heading'
    case 'paragraph':
      return isImageParagraph(node) ? 'image' : 'paragraph'
    case 'list':
      return 'list'
    case 'table':
      return 'table'
    case 'code':
      return isDiagram(node) ? 'diagram' : 'code'
    case 'diffCode':
    case 'codeGroup':
      return 'code'
    case 'blockquote':
      return 'quote'
    case 'thematicBreak':
      return 'divider'
    case 'containerDirective':
      return claims(calloutDirective, node) || isCalloutType(node.name) ? 'callout' : 'block'
    default:
      return 'block'
  }
}

function excerpt(node: Flow): string {
  const text = plainText(node).replaceAll(/\s+/g, ' ').trim()
  if (text.length <= EXCERPT_LENGTH) return text
  return `${text.slice(0, EXCERPT_LENGTH - 1).trimEnd()}…`
}
