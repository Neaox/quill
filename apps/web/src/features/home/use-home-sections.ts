import { useQueries } from '@tanstack/react-query'

import {
  useApiClient,
  workspaceDocumentsQueryOptions,
  type DocumentDto,
  type WorkspaceSummaryDto,
} from '../../lib/api/index.ts'
import { documentReference } from '../../lib/routing/document-reference.ts'

/** How many rows a home section shows before it stops being a summary. */
export const HOME_SECTION_LIMIT = 10

export interface HomeDocument {
  readonly id: string
  /** How the document is addressed in a URL (ADR-035). */
  readonly reference: string
  readonly title: string
  readonly updatedAt: string
  readonly workspaceId: string
  /** The workspace's own address, for the link (ADR-035). */
  readonly workspaceSlug: string
  readonly workspaceName: string
}

export interface HomeSections {
  /** Documents with work in them that has never been published. */
  readonly continueWith: readonly HomeDocument[]
  /** The newest published changes across every workspace. */
  readonly recentlyUpdated: readonly HomeDocument[]
  readonly isPending: boolean
}

function newestFirst(a: HomeDocument, b: HomeDocument): number {
  return b.updatedAt.localeCompare(a.updatedAt)
}

/**
 * The signed-in home's two document sections (`docs/design/home.md`).
 *
 * There is no cross-workspace document route in M2, so each workspace's list
 * is fetched on its own — `useQueries` runs them in parallel and they are the
 * same cache entries the workspace pages read, so opening a workspace
 * afterwards costs nothing. The lists are small (a workspace's documents, not
 * its revisions) and this is the only page that fans out.
 *
 * What the list DTO can answer, and what it cannot: it carries `status` and
 * `headRevision`, so "never published" is exactly knowable and is what
 * **Continue** is built from. It does **not** carry the lock holder, or the
 * draft's revision, so "somebody is editing this right now" and "the draft is
 * ahead of what is published" cannot be asked of it — those live in each
 * document's own envelope (ADR-031), which would be one request per document.
 * The section says so rather than quietly showing less than its name promises.
 */
export function useHomeSections(workspaces: readonly WorkspaceSummaryDto[]): HomeSections {
  const client = useApiClient()
  const byId = new Map(workspaces.map((workspace) => [workspace.id, workspace]))

  const results = useQueries({
    queries: workspaces.map((workspace) => workspaceDocumentsQueryOptions(client, workspace.id)),
  })

  const isPending = results.some((result) => result.isPending)
  const documents: readonly (readonly DocumentDto[])[] = results.map((result) => result.data ?? [])

  const rows: readonly HomeDocument[] = documents.flat().map((document) => ({
    id: document.id,
    reference: documentReference(document),
    title: document.title,
    updatedAt: document.updatedAt,
    workspaceId: document.workspaceId,
    workspaceSlug: byId.get(document.workspaceId)?.slug ?? document.workspaceId,
    workspaceName: byId.get(document.workspaceId)?.name ?? 'Workspace',
  }))

  const published = new Set(
    documents
      .flat()
      .filter((document) => document.headRevision !== null)
      .map((document) => document.id),
  )

  return {
    continueWith: rows
      .filter((row) => !published.has(row.id))
      .toSorted(newestFirst)
      .slice(0, HOME_SECTION_LIMIT),
    recentlyUpdated: rows
      .filter((row) => published.has(row.id))
      .toSorted(newestFirst)
      .slice(0, HOME_SECTION_LIMIT),
    isPending,
  }
}
