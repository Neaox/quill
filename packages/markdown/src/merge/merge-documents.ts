import type { Root, RootContent } from 'mdast'
import { isDeepEqual } from 'remeda'

import { readFrontMatter, writeFrontMatter } from '../front-matter/yaml-document.ts'
import { cleanItems, mergeSequences } from './merge-sequences.ts'
import type { MergeSegment, SequenceMergeOptions } from './merge-sequences.ts'

/**
 * The three-way merge of two drafts of a document (ADR-021, amendment of
 * 2026-10-11), and of two publishes of it (plan section 9): one engine, so
 * drafts and publishing cannot disagree about what a conflict is.
 *
 * - **Blocks first.** The top-level blocks of base, mine and theirs are
 *   matched by content and position (a longest common subsequence over their
 *   content keys), so a block inserted, deleted or moved on one side is
 *   recognised as that, and an edit by the other side follows a moved block.
 * - **Then inside blocks both sides changed**, by the node's own structure:
 *   list items by item, table rows by row and then cells, a container's blocks
 *   by block, text by words, code, HTML and math by line, and a directive's
 *   attributes and front-matter fields one attribute at a time.
 * - **What still overlaps is a conflict**, at the granularity of top-level
 *   blocks: a conflict carries the base, mine and theirs of its span, and the
 *   merged tree is everything else, with each conflict's place in it.
 *
 * Pure and synchronous, over mdast and nothing else, so it runs unchanged on
 * the server, in the browser, and in a worker (`merge-worker.ts`).
 */

/** Two edits of the same blocks that could not be combined. */
export interface BlockConflict {
  /** Where in `merged.children` the resolution of this conflict goes. */
  readonly index: number
  readonly base: readonly RootContent[]
  readonly mine: readonly RootContent[]
  readonly theirs: readonly RootContent[]
}

export interface DocumentMerge {
  /** The merged document, without the conflicting spans. */
  readonly merged: Root
  /** In document order; empty when the merge is clean. */
  readonly conflicts: readonly BlockConflict[]
}

/**
 * How a person resolved one conflict. "Keep both" puts mine below theirs
 * (ADR-021): theirs was saved first, so it reads first.
 */
export type ConflictResolution =
  | { readonly kind: 'mine' }
  | { readonly kind: 'theirs' }
  | { readonly kind: 'both' }
  | { readonly kind: 'edited'; readonly blocks: readonly RootContent[] }

/** The shape every node shares; the walk below is structural so new node types merge too. */
interface TreeNode {
  readonly type: string
}

const keys = new WeakMap<object, string>()

/**
 * A node's content, as a string two equal nodes share: everything but where it
 * was in the source. Cached per node object, because a merge asks for the
 * same block's key many times and nodes are never mutated.
 */
export function contentKey(node: object): string {
  const cached = keys.get(node)
  if (cached !== undefined) return cached
  // `sourceForm` is how a node was written (blank lines, markers, padding),
  // not what it says, and the same block can carry a different one in a
  // different place; it is ignored here so a block always matches itself.
  const key = JSON.stringify(node, (name, value: unknown) =>
    name === 'position' || name === 'sourceForm' ? undefined : value,
  )
  keys.set(node, key)
  return key
}

const nodeType = (node: TreeNode): string => node.type

/** Anything between words, for comparing what two blocks say. */
const NOT_A_WORD = /[^\p{L}\p{N}]+/u

const vocabularies = new WeakMap<object, ReadonlySet<string>>()

/** The words a node's text holds, at any depth. */
function vocabulary(node: TreeNode): ReadonlySet<string> {
  const cached = vocabularies.get(node)
  if (cached !== undefined) return cached
  const found = new Set<string>()
  for (const word of (valueOf(node) ?? '').toLowerCase().split(NOT_A_WORD)) found.add(word)
  for (const child of childrenOf(node) ?? []) for (const word of vocabulary(child)) found.add(word)
  found.delete('')
  vocabularies.set(node, found)
  return found
}

/**
 * How alike two blocks are: the share of their words they have in common
 * (Jaccard), or 1 when neither has any. A block one side removed and one it
 * wrote in the same place that share no word were rewritten from scratch,
 * and are merged as a deletion and an insertion rather than an edit.
 */
function similarity(before: TreeNode, after: TreeNode): number {
  const left = vocabulary(before)
  const right = vocabulary(after)
  if (left.size === 0 && right.size === 0) return 1
  let shared = 0
  for (const word of left) if (right.has(word)) shared += 1
  return shared / (left.size + right.size - shared)
}
const identity = (token: string): string => token

function isNode(value: unknown): value is TreeNode {
  return (
    typeof value === 'object' && value !== null && 'type' in value && typeof value.type === 'string'
  )
}

function isNodeList(value: unknown): value is readonly TreeNode[] {
  return Array.isArray(value) && value.every(isNode)
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function childrenOf(node: TreeNode): readonly TreeNode[] | undefined {
  const children = 'children' in node ? node.children : undefined
  return isNodeList(children) ? children : undefined
}

function valueOf(node: TreeNode): string | undefined {
  const value = 'value' in node ? node.value : undefined
  return typeof value === 'string' ? value : undefined
}

/** Merges one record-valued field a key at a time; `drop` names keys that give way on conflict. */
const NESTED_FIELDS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  // A directive's attributes are merged one attribute at a time.
  ['attributes', new Set<string>()],
  // `data.sourceForm` remembers how a node was written; it is a formatting
  // hint the serialiser checks before trusting (`source-form.ts`), so where
  // the two sides disagree about it, it is dropped rather than conflicted.
  ['data', new Set(['sourceForm'])],
])

/** The fields merged by the structure-aware paths, not as plain values. */
const STRUCTURAL_FIELDS: ReadonlySet<string> = new Set(['type', 'children', 'value', 'position'])

/** Values in code, HTML and math are merged by line; everything else by word. */
const LINE_VALUES: ReadonlySet<string> = new Set(['code', 'html', 'math', 'yaml'])

/** No value: the field is absent. Distinct from a conflict. */
const ABSENT = Symbol('absent')
const CONFLICT = Symbol('conflict')

type Merged = unknown

/** The three-way merge of one plain value, compared by content. */
function mergeValue(base: unknown, mine: unknown, theirs: unknown): Merged | typeof CONFLICT {
  if (isDeepEqual(mine, theirs)) return mine
  if (isDeepEqual(mine, base)) return theirs
  if (isDeepEqual(theirs, base)) return mine
  return CONFLICT
}

function entry(record: Readonly<Record<string, unknown>>, key: string): unknown {
  return Object.hasOwn(record, key) ? record[key] : ABSENT
}

/** A record merged key by key; keys in `yielding` are dropped on conflict instead. */
function mergeRecord(
  base: Readonly<Record<string, unknown>>,
  mine: Readonly<Record<string, unknown>>,
  theirs: Readonly<Record<string, unknown>>,
  yielding: ReadonlySet<string>,
): Record<string, unknown> | typeof CONFLICT {
  const merged: Record<string, unknown> = {}
  const names = new Set([...Object.keys(base), ...Object.keys(mine), ...Object.keys(theirs)])
  for (const name of names) {
    const value = mergeValue(entry(base, name), entry(mine, name), entry(theirs, name))
    if (value === CONFLICT) {
      if (yielding.has(name)) continue
      return CONFLICT
    }
    if (value !== ABSENT) merged[name] = value
  }
  return merged
}

/** A node's own fields — everything but its content — merged one by one. */
function mergeFields<N extends TreeNode>(base: N, mine: N, theirs: N): N | undefined {
  const merged: N = { ...theirs }
  const [baseFields, mineFields, theirFields] = [fieldsOf(base), fieldsOf(mine), fieldsOf(theirs)]
  const names = new Set([...Object.keys(base), ...Object.keys(mine), ...Object.keys(theirs)])
  for (const name of names) {
    if (STRUCTURAL_FIELDS.has(name)) continue
    const [o, a, b] = [entry(baseFields, name), entry(mineFields, name), entry(theirFields, name)]
    const yielding = NESTED_FIELDS.get(name)
    let value: Merged | typeof CONFLICT = mergeValue(o, a, b)
    if (value === CONFLICT && yielding !== undefined) {
      value = mergeRecord(
        isRecord(o) ? o : {},
        isRecord(a) ? a : {},
        isRecord(b) ? b : {},
        yielding,
      )
    }
    if (value === CONFLICT) return undefined
    // The copy is a node of the same type as all three, and every field it
    // gets is one of theirs; the walk is structural so node types this module
    // has never heard of merge too, which is why the write is by name.
    if (value === ABSENT) Reflect.deleteProperty(merged, name)
    else Reflect.set(merged, name, value)
  }
  return merged
}

function fieldsOf(node: TreeNode): Readonly<Record<string, unknown>> {
  return Object.fromEntries(Object.entries(node))
}

/** Splits text into words and the whitespace between them, both kept. */
function words(text: string): string[] {
  return text.split(/(\s+)/u).filter((token) => token !== '')
}

function lines(text: string): string[] {
  return text.split('\n')
}

/** Text merged by words (or lines); undefined where both sides changed the same words. */
function mergeText(
  base: string,
  mine: string,
  theirs: string,
  split: (text: string) => string[],
  separator: string,
): string | undefined {
  const merged = cleanItems(
    mergeSequences(split(base), split(mine), split(theirs), { key: identity }),
  )
  return merged?.join(separator)
}

/**
 * Front matter merged one field at a time. The text is first merged by line,
 * which keeps every comment and the order both sides wrote; only when that
 * overlaps are the fields merged as values and written back over the base.
 */
function mergeFrontMatter(base: string, mine: string, theirs: string): string | undefined {
  const byLine = mergeText(base, mine, theirs, lines, '\n')
  if (byLine !== undefined && readFrontMatter(byLine).warnings.length === 0) return byLine
  const [o, a, b] = [readFrontMatter(base), readFrontMatter(mine), readFrontMatter(theirs)]
  if ([o, a, b].some((read) => read.warnings.length > 0)) return undefined
  const merged = mergeRecord(o.value, a.value, b.value, new Set())
  return merged === CONFLICT ? undefined : writeFrontMatter(merged, base)
}

function mergeLeafValue(
  type: string,
  base: string,
  mine: string,
  theirs: string,
): string | undefined {
  if (type === 'yaml') return mergeFrontMatter(base, mine, theirs)
  return LINE_VALUES.has(type)
    ? mergeText(base, mine, theirs, lines, '\n')
    : mergeText(base, mine, theirs, words, '')
}

/**
 * Merges one node both sides changed, by its structure: its own fields, then
 * its children as a sequence (items, rows, cells, blocks, inline runs), or its
 * value as text. Undefined when the two cannot be combined. The three are of
 * one type: the sequence merge only pairs items whose types agree.
 */
function mergeNode<N extends TreeNode>(base: N, mine: N, theirs: N): N | undefined {
  const fields = mergeFields(base, mine, theirs)
  if (fields === undefined) return undefined

  const children = [childrenOf(base), childrenOf(mine), childrenOf(theirs)]
  const [o, a, b] = children
  if (o !== undefined && a !== undefined && b !== undefined) {
    const merged = cleanItems(mergeSequences(o, a, b, CHILD_MERGE))
    if (merged === undefined) return undefined
    Reflect.set(fields, 'children', merged)
    return fields
  }
  if (children.some((list) => list !== undefined)) return undefined

  const [baseValue, mineValue, theirValue] = [valueOf(base), valueOf(mine), valueOf(theirs)]
  if (baseValue === undefined || mineValue === undefined || theirValue === undefined) {
    return baseValue === mineValue && mineValue === theirValue ? fields : undefined
  }
  const value = mergeLeafValue(base.type, baseValue, mineValue, theirValue)
  if (value === undefined) return undefined
  Reflect.set(fields, 'value', value)
  return fields
}

/** Children of any node: paired by type, merged by structure. */
const CHILD_MERGE = {
  key: contentKey,
  pairKey: nodeType,
  mergeItem: mergeNode,
  similarity,
  detectMoves: true,
} satisfies SequenceMergeOptions<TreeNode>

/** A top-level block keeps its mdast type through a merge; this says so to the compiler. */
function sameKind(like: RootContent, node: TreeNode): node is RootContent {
  return node.type === like.type
}

const BLOCK_MERGE = {
  key: contentKey,
  pairKey: nodeType,
  mergeItem: (base: RootContent, mine: RootContent, theirs: RootContent) => {
    const merged = mergeNode<TreeNode>(base, mine, theirs)
    return merged !== undefined && sameKind(base, merged) ? merged : undefined
  },
  similarity,
  detectMoves: true,
} satisfies SequenceMergeOptions<RootContent>

/** The merged document and its conflicts, from the block-level segments. */
function assemble(like: Root, segments: readonly MergeSegment<RootContent>[]): DocumentMerge {
  const children: RootContent[] = []
  const conflicts: BlockConflict[] = []
  for (const segment of segments) {
    if (segment.kind === 'merged') children.push(...segment.items)
    else {
      conflicts.push({
        index: children.length,
        base: segment.base,
        mine: segment.mine,
        theirs: segment.theirs,
      })
    }
  }
  return { merged: { ...like, children }, conflicts }
}

/**
 * Merges `mine` and `theirs`, two documents both derived from `base`.
 *
 * Where one side changed nothing, the other side is the answer, as the same
 * object: merging is the identity there, which is what makes it safe to run
 * on every reconnect.
 */
const blockKeys = (root: Root): string[] => root.children.map(contentKey)

const sameKeys = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((key, index) => key === right[index])

export function mergeDocuments(base: Root, mine: Root, theirs: Root): DocumentMerge {
  // Compared block by block rather than as whole trees: the blocks' keys are
  // the ones the merge needs anyway, so nothing is serialised twice.
  const [o, a, b] = [blockKeys(base), blockKeys(mine), blockKeys(theirs)]
  if (sameKeys(a, o) || sameKeys(a, b)) return { merged: theirs, conflicts: [] }
  if (sameKeys(b, o)) return { merged: mine, conflicts: [] }
  const segments = mergeSequences(base.children, mine.children, theirs.children, BLOCK_MERGE)
  return assemble(theirs, segments)
}

function blocksFor(
  conflict: BlockConflict,
  resolution: ConflictResolution,
): readonly RootContent[] {
  switch (resolution.kind) {
    case 'mine':
      return conflict.mine
    case 'theirs':
      return conflict.theirs
    case 'both':
      return [...conflict.theirs, ...conflict.mine]
    case 'edited':
      return resolution.blocks
  }
}

/**
 * The document once every conflict is resolved, one resolution per conflict
 * in order. Undefined while any is still open.
 */
export function resolveMerge(
  merge: DocumentMerge,
  resolutions: readonly (ConflictResolution | undefined)[],
): Root | undefined {
  const children: RootContent[] = []
  let next = 0
  for (const [position, conflict] of merge.conflicts.entries()) {
    const resolution = resolutions[position]
    if (resolution === undefined) return undefined
    children.push(...merge.merged.children.slice(next, conflict.index))
    children.push(...blocksFor(conflict, resolution))
    next = conflict.index
  }
  children.push(...merge.merged.children.slice(next))
  return { ...merge.merged, children }
}
