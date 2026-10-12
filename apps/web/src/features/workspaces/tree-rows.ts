import type { VirtualTreeRow } from '@quill/ui'

import type { TreeChildDto, TreeChildrenPage, TreeLevel } from '../../lib/api/index.ts'

/**
 * The navigation tree as the rows a reader sees (ADR-049).
 *
 * The tree is loaded a level and a page at a time, and only what is open is looked at, so
 * the rows are built by walking from each collection down through the nodes that are open,
 * reading whatever pages of each level have arrived. It is a pure walk over what is held:
 * it asks, as it goes, for the pages it would need to carry on (`wanted`), and the caller
 * makes sure they are being fetched, which brings the rest the next time it is drawn.
 */

/** A level is paged at most this far to find the document being read, which is a bound, not a goal. */
export const MAX_PAGES_TO_FIND = 100

export interface PageRead {
  readonly page: TreeChildrenPage | undefined
  /** The page was asked for and could not be had. */
  readonly failed: boolean
}

export interface WantedPage {
  readonly level: TreeLevel
  readonly cursor: string | null
}

export interface BuildTreeRowsInput {
  readonly collections: readonly { readonly id: string }[]
  /** What a collection's own row is. */
  readonly section: (collection: { readonly id: string }) => VirtualTreeRow
  /** What a document's row is, given where it is. */
  readonly node: (
    node: TreeChildDto,
    place: {
      readonly collectionId: string
      readonly depth: number
      readonly position: number
      readonly siblings: number
      readonly expanded: boolean
    },
  ) => VirtualTreeRow
  readonly isOpen: (id: string) => boolean
  /** How many pages of a level the reader has asked for; one before they ask for more. */
  readonly pagesShown: (levelKey: string) => number
  /** Read what is held of one page of one level. */
  readonly read: (level: TreeLevel, cursor: string | null) => PageRead
  /** The document being read, and the level it is in: that level is paged until it is found. */
  readonly current?: { readonly id: string; readonly level: TreeLevel } | undefined
}

export interface BuiltTreeRows {
  readonly rows: readonly VirtualTreeRow[]
  readonly wanted: readonly WantedPage[]
}

/** What names a level among all the others, for the parts of the tree that remember something about it. */
export function levelKey(level: TreeLevel): string {
  return `${level.collectionId}|${level.parentId ?? ''}`
}

export function buildTreeRows(input: BuildTreeRowsInput): BuiltTreeRows {
  const rows: VirtualTreeRow[] = []
  const wanted: WantedPage[] = []

  function walk(level: TreeLevel, depth: number) {
    const key = levelKey(level)
    const finding =
      input.current !== undefined && levelKey(input.current.level) === key
        ? input.current.id
        : undefined
    const nodes: TreeChildDto[] = []
    let cursor: string | null = null
    let more = false
    let status: 'loading' | 'failed' | undefined
    for (let pages = 1; ; pages += 1) {
      wanted.push({ level, cursor })
      const { page, failed } = input.read(level, cursor)
      if (page === undefined) {
        status = failed ? 'failed' : 'loading'
        break
      }
      nodes.push(...page.nodes)
      if (page.next === undefined) break
      const asked = pages >= input.pagesShown(key)
      const found = finding === undefined || nodes.some(({ id }) => id === finding)
      if (asked && (found || pages >= MAX_PAGES_TO_FIND)) {
        more = true
        break
      }
      cursor = page.next
    }

    for (const [index, node] of nodes.entries()) {
      const expanded = node.childCount > 0 && input.isOpen(node.id)
      rows.push(
        input.node(node, {
          collectionId: level.collectionId,
          depth,
          position: index + 1,
          // Unknown while there is more to load: ARIA's own word for that is -1.
          siblings: more ? -1 : nodes.length,
          expanded,
        }),
      )
      if (expanded) walk({ collectionId: level.collectionId, parentId: node.id }, depth + 1)
    }
    if (more) {
      rows.push({ kind: 'more', id: `more:${key}`, depth, label: 'Show more', busy: false })
    }
    if (status !== undefined) {
      rows.push({
        kind: 'status',
        id: `status:${key}`,
        depth,
        label: status === 'loading' ? 'Loading…' : 'Couldn’t load these documents',
        busy: status === 'loading',
      })
    }
  }

  for (const collection of input.collections) {
    rows.push(input.section(collection))
    walk({ collectionId: collection.id, parentId: null }, 0)
  }
  return { rows, wanted }
}
