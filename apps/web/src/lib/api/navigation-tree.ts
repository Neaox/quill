import { useCallback, useRef } from 'react'
import { keepPreviousData, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'

import type { ApiClient } from '@quill/api-client'

import { useApiClient } from './client-context.tsx'
import { request } from './http.ts'
import { queryKeys } from './query-keys.ts'
import type { TreeChildrenResponse, WorkspaceTreeResponse } from './types.ts'

/**
 * The sidebar's tree, loaded a slice at a time.
 *
 * `GET /workspaces/:id/tree` answers the whole tree, which in a workspace of
 * tens of thousands of documents is megabytes nobody unfolds. The sidebar asks
 * instead for one level, a page of each list, and the way down to the
 * document being read (`depth`, `limit`, `focus`), then for each further page
 * as it is opened (`GET /workspaces/:id/tree/children`), and keeps what it has
 * been sent here: every node once, and every list as the contiguous slice of
 * it that is loaded, with its total.
 *
 * It lives in the query cache under the workspace tree's own key, so every
 * mutation that invalidates the tree reloads it too.
 */

/** As many entries of a list as the sidebar draws before "Show more" (`TREE_PAGE_SIZE`). */
export const NAVIGATION_PAGE_SIZE = 50

type ResponseNode = WorkspaceTreeResponse['collections'][number]['documents'][number]

export interface NavigationNode {
  readonly id: string
  readonly shortId: string
  readonly title: string
  readonly slug: string
  readonly status: ResponseNode['status']
  /** How many children it has in all, loaded or not. */
  readonly childCount: number
}

/** The loaded, contiguous slice of one list, and how long the list is. */
export interface NavigationList {
  readonly offset: number
  readonly total: number
  readonly ids: readonly string[]
}

export interface NavigationCollection {
  readonly id: string
  readonly name: string
  readonly slug: string
  /** Every document in it the reader can see, nesting included. */
  readonly total: number
}

export interface NavigationTree {
  readonly collections: readonly NavigationCollection[]
  readonly nodes: ReadonlyMap<string, NavigationNode>
  readonly lists: ReadonlyMap<string, NavigationList>
}

/** Whose list: a collection's top level, or a document's children. */
export const listKey = {
  collection: (id: string) => `collection:${id}`,
  document: (id: string) => `document:${id}`,
}

function countAll(nodes: readonly ResponseNode[]): number {
  return nodes.reduce((sum, entry) => sum + 1 + countAll(entry.children), 0)
}

function toNode(entry: ResponseNode): NavigationNode {
  return {
    id: entry.id,
    shortId: entry.shortId,
    title: entry.title,
    slug: entry.slug,
    status: entry.status,
    childCount: entry.childCount ?? entry.children.length,
  }
}

/** Every node and list in a response, nested lists included. */
function collect(
  entries: readonly ResponseNode[],
  nodes: Map<string, NavigationNode>,
  lists: Map<string, NavigationList>,
): void {
  for (const entry of entries) {
    nodes.set(entry.id, toNode(entry))
    const total = entry.childCount ?? entry.children.length
    // Children counted but not sent are not a loaded list: an empty one would
    // say "loaded, and empty".
    if (entry.children.length > 0 || total === 0) {
      lists.set(listKey.document(entry.id), {
        offset: entry.childrenOffset ?? 0,
        total,
        ids: entry.children.map((child) => child.id),
      })
    }
    collect(entry.children, nodes, lists)
  }
}

export function fromTreeResponse(response: WorkspaceTreeResponse): NavigationTree {
  const nodes = new Map<string, NavigationNode>()
  const lists = new Map<string, NavigationList>()
  const collections = response.collections.map((collection) => {
    lists.set(listKey.collection(collection.id), {
      offset: collection.documentsOffset ?? 0,
      total: collection.documentCount ?? collection.documents.length,
      ids: collection.documents.map((entry) => entry.id),
    })
    collect(collection.documents, nodes, lists)
    return {
      id: collection.id,
      name: collection.name,
      slug: collection.slug,
      total: collection.total ?? countAll(collection.documents),
    }
  })
  return { collections, nodes, lists }
}

/**
 * Two slices of one list as one. Slices that touch or overlap are joined;
 * slices apart keep the newer, which is the one the reader has just asked for.
 */
export function mergeList(
  existing: NavigationList | undefined,
  incoming: NavigationList,
): NavigationList {
  if (existing === undefined) return incoming
  const existingEnd = existing.offset + existing.ids.length
  const incomingEnd = incoming.offset + incoming.ids.length
  if (incoming.offset > existingEnd || existing.offset > incomingEnd) return incoming
  const offset = Math.min(existing.offset, incoming.offset)
  const ids: string[] = []
  for (const slice of [existing, incoming]) {
    for (const [index, id] of slice.ids.entries()) ids[slice.offset - offset + index] = id
  }
  return { offset, total: incoming.total, ids }
}

function mergeLists(
  base: ReadonlyMap<string, NavigationList>,
  incoming: ReadonlyMap<string, NavigationList>,
): ReadonlyMap<string, NavigationList> {
  const lists = new Map(base)
  for (const [key, list] of incoming) lists.set(key, mergeList(lists.get(key), list))
  return lists
}

/** A later response — the way down to another document — added to what is loaded. */
export function mergeTree(base: NavigationTree, response: WorkspaceTreeResponse): NavigationTree {
  const incoming = fromTreeResponse(response)
  return {
    collections: incoming.collections,
    nodes: new Map([...base.nodes, ...incoming.nodes]),
    lists: mergeLists(base.lists, incoming.lists),
  }
}

/** A page of one list added to what is loaded. */
export function withPage(
  base: NavigationTree,
  key: string,
  page: TreeChildrenResponse,
): NavigationTree {
  const nodes = new Map(base.nodes)
  for (const entry of page.documents) nodes.set(entry.id, toNode(entry))
  return {
    collections: base.collections,
    nodes,
    lists: mergeLists(
      base.lists,
      new Map([
        [
          key,
          { offset: page.offset, total: page.total, ids: page.documents.map((entry) => entry.id) },
        ],
      ]),
    ),
  }
}

function navigationKey(workspaceId: string) {
  return [...queryKeys.workspaceTree(workspaceId), 'navigation'] as const
}

function fetchTree(client: ApiClient, workspaceId: string, focus: string | undefined) {
  return request<WorkspaceTreeResponse>(
    client.GET('/api/workspaces/{id}/tree', {
      params: {
        path: { id: workspaceId },
        query: {
          depth: 1,
          limit: NAVIGATION_PAGE_SIZE,
          ...(focus === undefined ? {} : { focus }),
        },
      },
    }),
  )
}

/**
 * The sidebar's tree for a workspace, opened down to `focus` (the document
 * being read, by id or reference) on the first load; `load` fetches a further
 * slice of one list into it.
 *
 * Moving to a document the loaded tree does not hold yet fetches the way down
 * to it and adds it, rather than reloading the tree; what was opened and
 * paged stays.
 */
export function useNavigationTree(workspaceId: string | undefined, focus: string | undefined) {
  const client = useApiClient()
  const queryClient = useQueryClient()
  const key = navigationKey(workspaceId ?? '')
  const tree = useQuery({
    queryKey: key,
    // The focus at the time of fetching: a refetch after an invalidation opens
    // the tree down to wherever the reader is by then.
    queryFn: async () => fromTreeResponse(await fetchTree(client, workspaceId ?? '', focus)),
    placeholderData: keepPreviousData,
    enabled: workspaceId !== undefined,
  })

  const missing =
    focus !== undefined && tree.data !== undefined && !holds(tree.data, focus) ? focus : undefined
  useQuery({
    queryKey: [...key, 'reveal', missing ?? ''],
    queryFn: async () => {
      const response = await fetchTree(client, workspaceId ?? '', missing)
      queryClient.setQueryData<NavigationTree>(key, (current) =>
        current === undefined ? fromTreeResponse(response) : mergeTree(current, response),
      )
      return true
    },
    enabled: workspaceId !== undefined && missing !== undefined,
    staleTime: Number.POSITIVE_INFINITY,
  })

  const inFlight = useRef(new Set<string>())
  const load = useCallback(
    (
      owner: { readonly kind: 'collection' | 'document'; readonly id: string },
      offset: number,
      limit: number,
    ) => {
      if (workspaceId === undefined) return
      const listId = listKey[owner.kind](owner.id)
      const asked = `${listId}@${String(offset)}+${String(limit)}`
      if (inFlight.current.has(asked)) return
      inFlight.current.add(asked)
      void loadPage(queryClient, client, workspaceId, owner, offset, limit).finally(() => {
        inFlight.current.delete(asked)
      })
    },
    [client, queryClient, workspaceId],
  )

  return { ...tree, load }
}

/** Whether a document, by id or by reference, is among the loaded nodes. */
function holds(tree: NavigationTree, focus: string): boolean {
  if (tree.nodes.has(focus)) return true
  // A reference ends in the document's short key (ADR-035).
  return [...tree.nodes.values()].some((entry) => focus.endsWith(entry.shortId))
}

async function loadPage(
  queryClient: QueryClient,
  client: ApiClient,
  workspaceId: string,
  owner: { readonly kind: 'collection' | 'document'; readonly id: string },
  offset: number,
  limit: number,
): Promise<void> {
  const page = await request<TreeChildrenResponse>(
    client.GET('/api/workspaces/{id}/tree/children', {
      params: {
        path: { id: workspaceId },
        query: {
          ...(owner.kind === 'collection' ? { collection: owner.id } : { parent: owner.id }),
          offset,
          // Whole pages, so neighbouring requests line up.
          limit: Math.max(limit, NAVIGATION_PAGE_SIZE),
        },
      },
    }),
  ).catch(() => undefined)
  if (page === undefined) return
  queryClient.setQueryData<NavigationTree>(navigationKey(workspaceId), (current) =>
    current === undefined ? current : withPage(current, listKey[owner.kind](owner.id), page),
  )
}
