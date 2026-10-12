import { useQueries } from '@tanstack/react-query'

import {
  useApiClient,
  workspaceDocumentsQueryOptions,
  type DocumentDto,
  type WorkspaceSummaryDto,
} from '../../lib/api/index.ts'
import { documentReference, workspaceReference } from '../../lib/routing/document-reference.ts'

/** How many drafts **Continue writing** shows: the few somebody can act on today. */
export const CONTINUE_LIMIT = 5

/** How many rows **Recently updated** shows before it stops being a summary. */
export const RECENT_LIMIT = 8

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

/** A workspace card's facts, counted from the same document list the workspace reads. */
export interface HomeWorkspace {
  readonly workspace: WorkspaceSummaryDto
  /** The workspace's own address, for the link (ADR-035). */
  readonly reference: string
  /** `undefined` until its document list has arrived: a count is never guessed. */
  readonly documentCount: number | undefined
  readonly draftCount: number | undefined
  /** The newest change to any document in it, or `undefined` for none yet. */
  readonly updatedAt: string | undefined
}

export interface HomeSections {
  /** Documents with work in them that has never been published, newest first. */
  readonly continueWith: readonly HomeDocument[]
  /** How many there are in all, which the section says when it shows fewer. */
  readonly draftTotal: number
  /** The newest published changes across every workspace. */
  readonly recentlyUpdated: readonly HomeDocument[]
  readonly workspaces: readonly HomeWorkspace[]
  /** Whether anything at all has been published yet — the set-up checklist's last step. */
  readonly anyPublished: boolean
  readonly isPending: boolean
}

function newestFirst(a: HomeDocument, b: HomeDocument): number {
  return b.updatedAt.localeCompare(a.updatedAt)
}

const neverPublished = (document: DocumentDto) => document.headRevision === null

/**
 * The signed-in home's sections (`docs/design/home.md`).
 *
 * There is no cross-workspace document route, so each workspace's list is
 * fetched on its own — `useQueries` runs them in parallel and they are the
 * same cache entries the workspace pages read, so opening a workspace
 * afterwards costs nothing. The lists are small (a workspace's documents, not
 * its revisions) and this is the only page that fans out. Every section and
 * every card's counts are derived from those lists in one pass; nothing is
 * stored.
 *
 * What the list DTO can answer, and what it cannot: it carries `status` and
 * `headRevision`, so "never published" is exactly knowable and is what
 * **Continue writing** is built from. It does **not** carry the lock holder or
 * the draft's revision, so "the draft is ahead of what is published" cannot be
 * asked of it — that lives in each document's own envelope (ADR-031), which
 * would be one request per document.
 */
export function useHomeSections(workspaces: readonly WorkspaceSummaryDto[]): HomeSections {
  const client = useApiClient()

  const results = useQueries({
    queries: workspaces.map((workspace) => workspaceDocumentsQueryOptions(client, workspace.id)),
  })

  const drafts: HomeDocument[] = []
  const published: HomeDocument[] = []
  const cards = workspaces.map((workspace, index): HomeWorkspace => {
    const documents = results[index]?.data
    const reference = workspaceReference(workspace)
    let draftCount = 0
    let updatedAt: string | undefined
    for (const document of documents ?? []) {
      const row: HomeDocument = {
        id: document.id,
        reference: documentReference(document),
        title: document.title,
        updatedAt: document.updatedAt,
        workspaceId: workspace.id,
        workspaceSlug: reference,
        workspaceName: workspace.name,
      }
      if (neverPublished(document)) {
        draftCount += 1
        drafts.push(row)
      } else {
        published.push(row)
      }
      if (updatedAt === undefined || document.updatedAt > updatedAt) updatedAt = document.updatedAt
    }
    return {
      workspace,
      reference,
      documentCount: documents?.length,
      draftCount: documents === undefined ? undefined : draftCount,
      updatedAt,
    }
  })

  return {
    continueWith: drafts.toSorted(newestFirst).slice(0, CONTINUE_LIMIT),
    draftTotal: drafts.length,
    recentlyUpdated: published.toSorted(newestFirst).slice(0, RECENT_LIMIT),
    workspaces: cards,
    anyPublished: published.length > 0,
    isPending: results.some((result) => result.isPending),
  }
}
