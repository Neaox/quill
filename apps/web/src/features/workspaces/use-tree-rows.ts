import { useQueries, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import type { TreeNodeAction, VirtualTreeRow } from '@quill/ui'

import {
  queryKeys,
  treeChildrenQueryOptions,
  useApiClient,
  useTreePosition,
  type CollectionDto,
  type TreeChildrenPage,
} from '../../lib/api/index.ts'
import { documentLink, documentReference } from '../../lib/routing/document-reference.ts'
import { buildTreeRows } from './tree-rows.ts'

export interface TreeRowsOptions {
  readonly workspaceId: string
  readonly workspaceSlug: string
  readonly collections: readonly CollectionDto[]
  /** The document being read: the tree is opened to it and kept paged until it is in view. */
  readonly currentId: string | undefined
  /** What a collection's own row offers. */
  readonly section: (collection: CollectionDto) => {
    readonly action: TreeNodeAction
    readonly actions: readonly TreeNodeAction[]
  }
  /** What a document's menu offers. */
  readonly nodeActions: (node: {
    readonly id: string
    readonly label: string
    readonly collectionId: string
  }) => readonly TreeNodeAction[]
}

export interface TreeRows {
  readonly rows: readonly VirtualTreeRow[]
  /** A document's toggle was pressed. */
  readonly toggle: (id: string) => void
  /** "Show more" was pressed; the id is the row's. */
  readonly more: (rowId: string) => void
}

const without = <T>(set: ReadonlySet<T>, value: T): ReadonlySet<T> =>
  new Set([...set].filter((each) => each !== value))

/**
 * The sidebar's rows (ADR-049): what is open, loaded a level and a page at a time.
 *
 * What is open is the reader's (`opened`, and `collapsed` for what they closed that the
 * document being read would otherwise keep open), plus the documents above the one being
 * read, which are opened for it. What has been loaded is the query cache's, read as the rows
 * are built and asked for through `useQueries`, so a document made or moved, which
 * invalidates the workspace's tree, asks again for the levels that are open and no others.
 */
export function useTreeRows({
  workspaceId,
  workspaceSlug,
  collections,
  currentId,
  section,
  nodeActions,
}: TreeRowsOptions): TreeRows {
  const client = useApiClient()
  const queryClient = useQueryClient()
  const position = useTreePosition(currentId)
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set())
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [shown, setShown] = useState<ReadonlyMap<string, number>>(new Map())
  // Going to another document opens the tree to it afresh, even where it was closed for the last.
  const [reading, setReading] = useState(currentId)
  if (reading !== currentId) {
    setReading(currentId)
    setCollapsed(new Set())
  }

  const above = position.data?.ancestors ?? []
  const isOpen = (id: string): boolean =>
    !collapsed.has(id) && (opened.has(id) || above.includes(id))
  const here = position.data

  const built = buildTreeRows({
    collections,
    section: (collection) => {
      const full = collections.find(({ id }) => id === collection.id)
      const offered = full === undefined ? undefined : section(full)
      return {
        kind: 'section',
        id: `collection:${collection.id}`,
        label: full?.name ?? '',
        ...(offered === undefined ? {} : { action: offered.action, actions: offered.actions }),
      }
    },
    node: (node, place) => ({
      kind: 'node',
      id: node.id,
      label: node.title,
      link: documentLink(workspaceSlug, documentReference(node)),
      depth: place.depth,
      position: place.position,
      siblings: place.siblings,
      expandable: node.childCount > 0,
      expanded: place.expanded,
      actions: nodeActions({ id: node.id, label: node.title, collectionId: place.collectionId }),
    }),
    isOpen,
    pagesShown: (key) => shown.get(key) ?? 1,
    read: (level, cursor) => {
      const key = queryKeys.treeChildren(workspaceId, level.collectionId, level.parentId, cursor)
      return {
        page: queryClient.getQueryData<TreeChildrenPage>(key),
        failed: queryClient.getQueryState(key)?.status === 'error',
      }
    },
    ...(currentId === undefined || here === undefined || here.collectionId === null
      ? {}
      : {
          current: {
            id: currentId,
            level: { collectionId: here.collectionId, parentId: here.ancestors.at(-1) ?? null },
          },
        }),
  })

  // Asking is what makes the rows arrive; the rows themselves are read from what is held.
  useQueries({
    queries: built.wanted.map(({ level, cursor }) =>
      treeChildrenQueryOptions(client, workspaceId, level, cursor),
    ),
  })

  function toggle(id: string) {
    if (isOpen(id)) {
      setOpened((now) => without(now, id))
      setCollapsed((now) => new Set([...now, id]))
    } else {
      setCollapsed((now) => without(now, id))
      setOpened((now) => new Set([...now, id]))
    }
  }

  function more(rowId: string) {
    const key = rowId.replace(/^more:/u, '')
    setShown((now) => new Map(now).set(key, (now.get(key) ?? 1) + 1))
  }

  return { rows: built.rows, toggle, more }
}
