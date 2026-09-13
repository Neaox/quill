import type { APIRequestContext } from '@playwright/test'

import { BROWSER_HEADERS } from './fixtures.ts'

/**
 * Documents written straight through the API, for the parts of a journey that
 * are about *reading* rather than about writing.
 *
 * A draft holds a versioned envelope around an mdast tree, exactly as the
 * editor writes it, so a fixture document is built the same way a real one is
 * and then published through the same route the Publish button calls. The
 * tree is spelled out here because e2e specs run outside every package's
 * module graph — they talk to the running HTTP API and import no application
 * code — so there is no Markdown parser to hand.
 */

/** The version stamped into every draft this platform writes (ADR-021, ADR-033). */
const DRAFT_CONTENT_VERSION = 1

interface MdastNode {
  readonly type: string
  readonly [key: string]: unknown
}

export function heading(depth: number, text: string): MdastNode {
  return { type: 'heading', depth, children: [{ type: 'text', value: text }] }
}

export function paragraph(text: string): MdastNode {
  return { type: 'paragraph', children: [{ type: 'text', value: text }] }
}

export function code(lang: string, value: string): MdastNode {
  return { type: 'code', lang, value }
}

export function table(rows: readonly (readonly string[])[]): MdastNode {
  return {
    type: 'table',
    align: (rows[0] ?? []).map(() => null),
    children: rows.map((cells) => ({
      type: 'tableRow',
      children: cells.map((cell) => ({
        type: 'tableCell',
        children: [{ type: 'text', value: cell }],
      })),
    })),
  }
}

/** `:::wide` — ADR-027's breakout wrapper, which is a container directive. */
export function wide(children: readonly MdastNode[]): MdastNode {
  return { type: 'containerDirective', name: 'wide', attributes: {}, children }
}

async function json<T>(response: {
  ok(): boolean
  status(): number
  text(): Promise<string>
}): Promise<T> {
  const body = await response.text()
  if (!response.ok()) {
    throw new Error(`Request failed with status ${response.status()}: ${body}`)
  }
  return JSON.parse(body) as T
}

export interface PublishedFixture {
  readonly id: string
  readonly title: string
  readonly revision: string
}

/**
 * Creates a document, writes the given blocks into its draft, and publishes
 * it — the same three calls the application makes, in the same order.
 */
export async function publishDocument(
  request: APIRequestContext,
  input: {
    readonly workspaceId: string
    readonly collectionId: string
    readonly title: string
    readonly blocks: readonly MdastNode[]
  },
): Promise<PublishedFixture> {
  const created = await json<{
    document: { id: string }
    draft: { draftVersion: number; baseRevision: string | null }
  }>(
    await request.post(`/api/workspaces/${input.workspaceId}/documents`, {
      headers: BROWSER_HEADERS,
      data: { collectionId: input.collectionId, title: input.title },
    }),
  )

  const documentId = created.document.id
  await json(
    await request.post(`/api/documents/${documentId}/lock/acquire`, {
      headers: BROWSER_HEADERS,
      data: {},
    }),
  )
  await json(
    await request.put(`/api/documents/${documentId}/draft`, {
      headers: BROWSER_HEADERS,
      data: {
        expectedVersion: created.draft.draftVersion,
        ast: {
          version: DRAFT_CONTENT_VERSION,
          frontMatter: { title: input.title },
          ast: { type: 'root', children: input.blocks },
        },
      },
    }),
  )
  await request.delete(`/api/documents/${documentId}/lock`, { headers: BROWSER_HEADERS })

  const published = await json<{ kind: string; revision: string }>(
    await request.post(`/api/documents/${documentId}/publish`, {
      headers: BROWSER_HEADERS,
      data: { base: created.draft.baseRevision, changeNote: 'Published for an end-to-end journey' },
    }),
  )
  if (published.kind !== 'published') {
    throw new Error(`Expected a publish, got ${published.kind}`)
  }

  return { id: documentId, title: input.title, revision: published.revision }
}

/** The id of a workspace collection by name, from the tree route. */
export async function collectionId(
  request: APIRequestContext,
  workspaceId: string,
  name: string,
): Promise<string> {
  const tree = await json<{ collections: { id: string; name: string }[] }>(
    await request.get(`/api/workspaces/${workspaceId}/tree`),
  )
  const collection = tree.collections.find((candidate) => candidate.name === name)
  if (collection === undefined) {
    throw new Error(`The seeded workspace has no "${name}" collection`)
  }
  return collection.id
}
