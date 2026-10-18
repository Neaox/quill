import type { Element, ElementContent, Properties } from 'hast'
import type { Schema } from 'hast-util-sanitize'
import type { Heading, Nodes, Root, RootContent } from 'mdast'
import { visit } from 'unist-util-visit'

import type { Handlers, State } from '../render/handlers.ts'
import type { RenderOptions } from '../render/html.ts'
import { renderHtmlWith } from '../render/html.ts'
import type { OutlineEntry } from '../render/outline.ts'
import { extractOutline } from '../render/outline.ts'
import { sanitizeSchema } from '../render/sanitize-schema.ts'
import type { ComparedChange, DocumentComparison } from './compare.ts'
import type { DiffCode } from './nodes.ts'
import { plainText } from './text.ts'

/**
 * A comparison drawn as a reader's page: the same renderer, the same
 * handlers and the same sanitiser as `renderHtml`, with three additions.
 *
 * - **Words.** An insertion is `<ins data-diff="added">` and a deletion
 *   `<del data-diff="removed">`, each opening with a visually hidden "Added:"
 *   or "Removed:" so the change is announced and never carried by colour
 *   alone. `data-diff` is what tells a change from a document's own
 *   strikethrough, which is also `<del>`.
 * - **Blocks.** Every marked block carries `data-change` (and the first block
 *   of each change its `data-change-id`, a before-and-after its `data-side`),
 *   which the stylesheet draws the margin marker and its label from.
 * - **Code.** A changed code block is drawn line by line, each changed line
 *   an `ins` or `del` with its changed words picked out.
 *
 * The allowlist is the document schema widened by exactly those attributes,
 * each pinned to the values these handlers emit; the document schema itself
 * is untouched, so no reader's page can carry them.
 */

export interface ComparisonSection {
  /** The heading's id in `html`, for a link to it. */
  readonly id: string
  readonly depth: number
  /** The heading as it reads now; as it read before, for a heading that was removed. */
  readonly title: string
  /** How many changes start in this section. */
  readonly changes: number
}

export interface SectionedChange extends ComparedChange {
  /** The section the change starts in; absent before the first heading. */
  readonly section?: { readonly id: string; readonly title: string } | undefined
  /** The change drawn on its own, as `html` draws it among the rest; only when asked for. */
  readonly html?: string | undefined
}

export interface ComparisonSummary {
  /** Sections with at least one change, counting the text before the first heading as one. */
  readonly sections: number
  readonly added: number
  readonly removed: number
  readonly changed: number
  readonly moved: number
  readonly wordsAdded: number
  readonly wordsRemoved: number
}

export interface RenderedComparison {
  readonly html: string
  readonly sections: readonly ComparisonSection[]
  readonly changes: readonly SectionedChange[]
  readonly summary: ComparisonSummary
}

/** Contents entries deeper than this are not sections a reader navigates by. */
const SECTION_DEPTH = 3

const NEWLINE = '\n'

export interface ComparisonDetail {
  /** Draw each change on its own too, for a view that shows one change at a time. */
  readonly patches?: boolean
}

export function renderComparison(
  comparison: DocumentComparison,
  options: RenderOptions = {},
  detail: ComparisonDetail = {},
): RenderedComparison {
  const drawn = (tree: Root): string =>
    renderHtmlWith(tree, options, { handlers: comparisonHandlers, schema: COMPARISON_SCHEMA })
  const { sections, changes } = sectionsOf(comparison)
  const detailed =
    detail.patches === true
      ? changes.map((change) => ({
          ...change,
          html: drawn({ type: 'root', children: [...change.nodes] }),
        }))
      : changes
  return { html: drawn(comparison.tree), sections, changes: detailed, summary: summarise(changes) }
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function flatten(entries: readonly OutlineEntry[]): OutlineEntry[] {
  return entries.flatMap((entry) => [entry, ...flatten(entry.children)])
}

/**
 * Which section each change starts in. The outline is taken from the very
 * tree that was rendered, so its ids are the ids in the HTML; the headings
 * are walked in the same order to give each top-level block the last heading
 * at or before it.
 */
function sectionsOf(comparison: DocumentComparison): {
  sections: ComparisonSection[]
  changes: SectionedChange[]
} {
  const outline = flatten(extractOutline(comparison.tree))
  const headings: Heading[] = []
  const lastHeadingAt: number[] = []
  for (const block of comparison.tree.children) {
    visit(block, 'heading', (heading: Heading) => {
      headings.push(heading)
    })
    lastHeadingAt.push(headings.length - 1)
  }
  const titled = outline.map((entry, index) => {
    const heading = headings[index]
    /* v8 ignore next -- the outline and the walk find the same headings. */
    return { entry, title: heading === undefined ? entry.text : headingTitle(heading) }
  })

  const changes = comparison.changes.map((change): SectionedChange => {
    /* v8 ignore next -- every change starts at a block of the tree. */
    const at = titled[lastHeadingAt[change.index] ?? -1]
    return at === undefined ? change : { ...change, section: { id: at.entry.id, title: at.title } }
  })
  const counts = Map.groupBy(changes, (change) => change.section?.id)
  const sections = titled
    .filter(({ entry }) => entry.depth <= SECTION_DEPTH)
    .map(({ entry, title }) => ({
      id: entry.id,
      depth: entry.depth,
      title,
      changes: counts.get(entry.id)?.length ?? 0,
    }))
  return { sections, changes }
}

/** A heading's words as they read now, or as they read before when it was removed. */
function headingTitle(heading: Heading): string {
  const side = (skip: Nodes['type']) => {
    const text = (node: Nodes): string => {
      if (node.type === skip) return ''
      if (!('children' in node)) return plainText(node)
      const children: readonly Nodes[] = node.children
      return children.map(text).join('')
    }
    return text(heading).trim()
  }
  const now = side('diffDeletion')
  return now === '' ? side('diffInsertion') : now
}

function summarise(changes: readonly SectionedChange[]): ComparisonSummary {
  const count = (kind: ComparedChange['change']) =>
    changes.filter((change) => change.change === kind).length
  return {
    sections: new Set(changes.map((change) => change.section?.id ?? '')).size,
    added: count('added'),
    removed: count('removed'),
    changed: count('changed'),
    moved: count('moved'),
    wordsAdded: changes.reduce((total, change) => total + change.wordsAdded, 0),
    wordsRemoved: changes.reduce((total, change) => total + change.wordsRemoved, 0),
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

function element(tagName: string, properties: Properties, children: ElementContent[]): Element {
  return { type: 'element', tagName, properties, children }
}

/** What a change is called to a screen reader, before the words it covers. */
const SPOKEN: Readonly<Record<'added' | 'removed', string>> = {
  added: 'Added: ',
  removed: 'Removed: ',
}

function spoken(change: 'added' | 'removed'): Element {
  return element('span', { 'data-diff-label': '' }, [{ type: 'text', value: SPOKEN[change] }])
}

function changeElement(change: 'added' | 'removed', children: ElementContent[]): Element {
  return element(change === 'added' ? 'ins' : 'del', { 'data-diff': change }, [
    spoken(change),
    ...children,
  ])
}

/**
 * A code block compared by line, in the card every code block sits in, so it
 * is the same grid item a reader's code block is and carries the block's
 * marks. A changed line is an `ins` or `del`; its sign, and what a screen
 * reader hears for it, are the stylesheet's, so copying the block copies
 * code and nothing else.
 */
function diffCode(node: DiffCode): Element {
  const lines = node.lines.flatMap((line): ElementContent[] => {
    // Only the words that changed inside an edited line are picked out; a
    // line wholly added or removed is marked by the line itself.
    const wholeLine = line.segments.every((segment) => segment.change !== 'equal')
    const parts = line.segments.map((segment): ElementContent =>
      segment.change === 'equal' || line.change === 'equal' || wholeLine
        ? { type: 'text', value: segment.text }
        : element('span', { 'data-diff-word': '' }, [{ type: 'text', value: segment.text }]),
    )
    const content: ElementContent =
      line.change === 'equal'
        ? element('span', { 'data-line': '' }, parts)
        : element(
            line.change === 'added' ? 'ins' : 'del',
            { 'data-diff': line.change, 'data-line': '' },
            parts,
          )
    return [content, { type: 'text', value: NEWLINE }]
  })
  const code = element(
    'code',
    node.lang === null || node.lang === undefined ? {} : { 'data-lang': node.lang },
    lines,
  )
  return element('div', { className: ['code-block'], ...node.data?.hProperties }, [
    element('pre', { 'data-diff-code': '' }, [code]),
  ])
}

/**
 * The renderer's handlers drop the `data` a comparison puts on a block —
 * most build their element themselves — so each is wrapped to carry the
 * block's marks onto the element it returns.
 */
function carryingMarks(handlers: Handlers): Handlers {
  return Object.fromEntries(
    Object.entries(handlers).map(([type, handler]) => [
      type,
      (state: State, node: RootContent, parent: Parameters<typeof handler>[2]) => {
        const result = handler(state, node, parent)
        const marks = node.data?.hProperties
        const first = Array.isArray(result) ? result.find(isElement) : result
        if (marks !== undefined && first !== undefined && isElement(first)) {
          first.properties = { ...first.properties, ...marks }
        }
        return result
      },
    ]),
  )
}

function isElement(node: unknown): node is Element {
  return typeof node === 'object' && node !== null && 'type' in node && node.type === 'element'
}

function comparisonHandlers(handlers: Handlers): Handlers {
  return {
    ...carryingMarks(handlers),
    diffInsertion: (state, node) => changeElement('added', state.all(node)),
    diffDeletion: (state, node) => changeElement('removed', state.all(node)),
    diffChars: (state, node) => element('span', { 'data-diff-char': '' }, state.all(node)),
    diffCode: (_state, node) => diffCode(node),
  }
}

// ---------------------------------------------------------------------------
// Allowlist
// ---------------------------------------------------------------------------

const BLOCK_CHANGES = ['added', 'removed', 'changed', 'moved']
const CHANGE_ID = /^c\d{1,6}$/

/* v8 ignore next -- the document schema always has attributes. */
const documentAttributes = sanitizeSchema.attributes ?? {}

type AttributeList = NonNullable<Schema['attributes']>[string]

/** What the document schema allows an element, and then the comparison's own marks. */
const widened = (tagName: string, ...marks: AttributeList): AttributeList => [
  ...(documentAttributes[tagName] ?? []),
  ...marks,
]

/** The document schema, widened by the comparison's own marks and nothing else. */
const COMPARISON_SCHEMA: Schema = {
  ...sanitizeSchema,
  attributes: {
    ...documentAttributes,
    '*': widened(
      '*',
      ['data-change', ...BLOCK_CHANGES],
      ['data-change-id', CHANGE_ID],
      ['data-side', 'before', 'after'],
    ),
    ins: widened('ins', ['data-diff', 'added'], ['data-line', '']),
    del: widened('del', ['data-diff', 'removed'], ['data-line', '']),
    span: widened(
      'span',
      ['data-diff-label', ''],
      ['data-diff-word', ''],
      ['data-diff-char', ''],
      ['data-line', ''],
    ),
    pre: widened('pre', ['data-diff-code', '']),
  },
}
