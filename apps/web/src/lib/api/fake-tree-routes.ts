import type { FakeRouteHandler, FakeRoutes } from './fake-routes.ts'

/**
 * The routes a navigation tree that opens a level at a time asks for, answered from the one
 * nested fixture a test already has for `GET /workspaces/:id/tree`: the collections, a page of
 * one parent's children, and where one document is. A test describes its tree once, as nested
 * documents, and the fake answers each of these as the server would (ADR-049).
 */

interface FixtureNode {
  readonly id: string
  readonly children?: readonly FixtureNode[]
  readonly [key: string]: unknown
}

interface FixtureCollection {
  readonly id: string
  readonly name: string
  readonly slug: string
  readonly documents: readonly FixtureNode[]
}

/** How many documents a fake page holds when the request does not say. */
const DEFAULT_LIMIT = 50

async function read(
  tree: FakeRouteHandler,
  request: Request,
): Promise<readonly FixtureCollection[]> {
  const response = await tree(request.clone(), {})
  if (!response.ok) return []
  const body: unknown = await response.json()
  return typeof body === 'object' && body !== null && 'collections' in body
    ? (body.collections as readonly FixtureCollection[])
    : []
}

function find(
  nodes: readonly FixtureNode[],
  id: string,
  above: readonly string[] = [],
): { node: FixtureNode; ancestors: readonly string[] } | undefined {
  for (const node of nodes) {
    if (node.id === id) return { node, ancestors: above }
    const inside = find(node.children ?? [], id, [...above, node.id])
    if (inside !== undefined) return inside
  }
  return undefined
}

const respond = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

export function withDerivedTreeRoutes(routes: FakeRoutes): FakeRoutes {
  const tree = routes['GET /api/workspaces/{id}/tree']
  if (tree === undefined) return routes
  const derived: Record<string, FakeRouteHandler> = {
    'GET /api/workspaces/{id}/collections': async (request) =>
      respond(
        (await read(tree, request)).map(({ id, name, slug }) => ({
          id,
          name,
          slug,
          workspaceId: 'workspace-1',
        })),
      ),
    'GET /api/workspaces/{id}/tree/children': async (request) => {
      const query = new URL(request.url).searchParams
      const collection = (await read(tree, request)).find(
        ({ id }) => id === query.get('collectionId'),
      )
      const parent = query.get('parentId')
      const level =
        parent === null
          ? (collection?.documents ?? [])
          : (find(collection?.documents ?? [], parent)?.node.children ?? [])
      const start = Number(query.get('cursor') ?? 0)
      const limit = Number(query.get('limit') ?? DEFAULT_LIMIT)
      const page = level.slice(start, start + limit)
      return respond({
        nodes: page.map(({ children, ...node }) => ({
          ...node,
          childCount: children?.length ?? 0,
        })),
        ...(start + limit < level.length ? { next: String(start + limit) } : {}),
      })
    },
    'GET /api/documents/{id}/tree-position': async (request, params) => {
      for (const collection of await read(tree, request)) {
        const found = find(collection.documents, params['id'] ?? '')
        if (found !== undefined) {
          return respond({
            collectionId: collection.id,
            ancestors: found.ancestors,
            childCount: found.node.children?.length ?? 0,
          })
        }
      }
      return respond({ collectionId: null, ancestors: [], childCount: 0 })
    },
  }
  return { ...derived, ...routes }
}
