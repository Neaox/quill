import type { DocumentId, Principal, ShortId, UserId, WorkspaceId } from '@quill/domain'

import type { DocumentRow, UserRepository } from '../ports/persistence.ts'
import { HISTORY_RETENTION_MS } from './document-views.ts'
import { listVisibleDocuments } from './list-visible-documents.ts'
import { listVisibleWorkspaces } from './list-visible-workspaces.ts'
import type { VisibleDocumentsDependencies } from './list-visible-documents.ts'
import type { VisibleWorkspace } from './list-visible-workspaces.ts'

/**
 * What the signed-in home needs, in one answer that does not grow.
 *
 * The home page used to ask for every workspace's whole document list and
 * count them in the browser, which is a request per workspace and a payload
 * per document: fine for a team, an outage for an organisation with hundreds
 * of workspaces and tens of thousands of documents. The same figures are
 * computed here, next to the data, through the very visibility pass every
 * other list uses (`listVisibleDocuments`), so a person is told about exactly
 * the documents they could open and no others. What leaves is bounded by the
 * two limits in the command plus one small row per workspace.
 *
 * The page is personal (ADR-053). Drafts are the ones the caller started;
 * recent changes default to the workspaces the caller works in and leave out
 * their own edits; jump back in lists what they opened. Each of those is read
 * by `user_id` (bounded) or taken from the visibility pass already made for
 * the workspace, so nothing here costs a query per document.
 *
 * Workspaces are walked a few at a time rather than all at once or one by
 * one: each walk reads a whole workspace into memory, and only a handful of
 * those may be alive together.
 */

/** How many workspaces are read at once: enough to overlap round trips, few enough to bound memory. */
export const WORKSPACES_IN_FLIGHT = 6

/** How many opened documents are looked at to find the ones that can still be opened. */
export const JUMP_BACK_IN_CANDIDATES = 50

/** How many documents "Jump back in" lists. */
export const JUMP_BACK_IN_LIMIT = 8

export interface HomeSummaryDependencies extends VisibleDocumentsDependencies {}

export type HomeScope = 'mine' | 'everywhere'

export interface GetHomeSummaryCommand {
  readonly userId: UserId
  readonly identities: readonly Principal[]
  readonly seesEverything: boolean
  /** How many never-published documents to return, newest first. */
  readonly draftLimit: number
  /** How many published documents to return, newest first. */
  readonly recentLimit: number
  /**
   * Which places "what changed" covers. Omitted, it is the caller's own places
   * when they have any history and everywhere when they have none.
   */
  readonly scope?: HomeScope | undefined
  /** Now, from the clock: the 90-day window is measured back from it. */
  readonly now: Date
}

/** A document as a list row: enough to show it and to link to it, nothing more. */
export interface HomeDocument {
  readonly id: DocumentId
  readonly shortId: ShortId
  readonly slug: string
  readonly title: string
  readonly workspaceId: WorkspaceId
  readonly updatedAt: Date
}

/** A published change, with who made it when that is known. */
export interface HomeRecentDocument extends HomeDocument {
  readonly updatedBy: { readonly id: UserId; readonly name: string } | null
}

/** A document the caller opened, and when they last did. */
export interface HomeViewedDocument extends Omit<HomeDocument, 'updatedAt'> {
  readonly viewedAt: Date
}

export interface HomeWorkspaceStats {
  readonly workspaceId: WorkspaceId
  readonly documentCount: number
  /** Documents never published: work that only its writers can see. */
  readonly draftCount: number
  /** When anything in it last changed, or null for an empty workspace. */
  readonly updatedAt: Date | null
  /** The caller's views plus documents they created here in the last 90 days; 0 when none. */
  readonly engagement: number
}

export interface HomeSummary {
  readonly workspaces: readonly VisibleWorkspace[]
  /** One row per workspace whose documents could be read. A workspace missing here has no figures, not zero. */
  readonly stats: readonly HomeWorkspaceStats[]
  /** Never-published documents the caller created, newest first. */
  readonly drafts: { readonly total: number; readonly items: readonly HomeDocument[] }
  readonly recent: readonly HomeRecentDocument[]
  /** What the caller opened most recently and can still open, newest first. */
  readonly jumpBackIn: readonly HomeViewedDocument[]
  /** The scope `recent` was computed for. */
  readonly scope: HomeScope
  /** Whether the caller has opened or created anything in the last 90 days. */
  readonly hasHistory: boolean
  /** Whether anything at all has been published: the set-up checklist's last step. */
  readonly anyPublished: boolean
}

/** A published change, kept with the id of whoever made it so the names are read once, in one query. */
interface PublishedChange extends HomeDocument {
  readonly updatedBy: UserId | null
}

const newestFirst = (a: HomeDocument, b: HomeDocument): number =>
  b.updatedAt.getTime() - a.updatedAt.getTime() || a.id.localeCompare(b.id)

const newest = <T extends HomeDocument>(documents: readonly T[], limit: number): T[] =>
  documents.toSorted(newestFirst).slice(0, limit)

const toHomeDocument = (row: DocumentRow): HomeDocument => ({
  id: row.id,
  shortId: row.shortId,
  slug: row.slug,
  title: row.title,
  workspaceId: row.workspaceId,
  updatedAt: row.updatedAt,
})

const toPublishedChange = (row: DocumentRow): PublishedChange => ({
  ...toHomeDocument(row),
  updatedBy: row.updatedBy,
})

interface WorkspaceDigest {
  readonly stats: Omit<HomeWorkspaceStats, 'engagement'>
  /** The newest never-published documents the caller created. */
  readonly ownDrafts: readonly HomeDocument[]
  readonly ownDraftCount: number
  readonly published: readonly PublishedChange[]
  /** The newest of `published` that the caller did not last change themselves. */
  readonly publishedByOthers: readonly PublishedChange[]
  readonly publishedCount: number
  /** Documents the caller created here since the window opened. */
  readonly createdRecently: number
  /** The visible documents among those the caller opened. */
  readonly opened: readonly DocumentRow[]
}

interface DigestContext {
  readonly command: GetHomeSummaryCommand
  readonly since: Date
  readonly openedIds: ReadonlySet<DocumentId>
}

async function digest(
  deps: HomeSummaryDependencies,
  { command, since, openedIds }: DigestContext,
  { workspace }: VisibleWorkspace,
): Promise<WorkspaceDigest | undefined> {
  const visible = await listVisibleDocuments(deps, {
    workspaceId: workspace.id,
    identities: command.identities,
    seesEverything: command.seesEverything,
  })
  // A workspace whose tree cannot be walked is left without figures rather
  // than failing everybody's home page (the picker does the same).
  if (visible.kind !== 'documents') return undefined

  const mine = (row: DocumentRow): boolean => row.createdBy === command.userId
  const drafts = visible.documents.filter((row) => row.headRevision === null)
  const published = visible.documents.filter((row) => row.headRevision !== null)
  const ownDrafts = drafts.filter(mine)
  const changes = published.map(toPublishedChange)
  const updatedAt = visible.documents.reduce<Date | null>(
    (latest, row) => (latest === null || row.updatedAt > latest ? row.updatedAt : latest),
    null,
  )
  return {
    stats: {
      workspaceId: workspace.id,
      documentCount: visible.documents.length,
      draftCount: drafts.length,
      updatedAt,
    },
    ownDrafts: newest(ownDrafts.map(toHomeDocument), command.draftLimit),
    ownDraftCount: ownDrafts.length,
    published: newest(changes, command.recentLimit),
    publishedByOthers: newest(
      changes.filter((change) => change.updatedBy !== command.userId),
      command.recentLimit,
    ),
    publishedCount: published.length,
    createdRecently: visible.documents.filter((row) => mine(row) && row.createdAt >= since).length,
    opened: visible.documents.filter((row) => openedIds.has(row.id)),
  }
}

export async function getHomeSummary(
  deps: HomeSummaryDependencies,
  command: GetHomeSummaryCommand,
): Promise<HomeSummary> {
  const { documentViews, users } = deps.uow.repos
  const since = new Date(command.now.getTime() - HISTORY_RETENTION_MS)
  const [{ workspaces }, opened, viewsByWorkspace] = await Promise.all([
    listVisibleWorkspaces(deps, command),
    documentViews.listRecent({ userId: command.userId, since, limit: JUMP_BACK_IN_CANDIDATES }),
    documentViews.sumByWorkspace({ userId: command.userId, since }),
  ])
  const context: DigestContext = {
    command,
    since,
    openedIds: new Set(opened.map((view) => view.documentId)),
  }

  const digests: (WorkspaceDigest | undefined)[] = []
  for (let from = 0; from < workspaces.length; from += WORKSPACES_IN_FLIGHT) {
    const batch = workspaces.slice(from, from + WORKSPACES_IN_FLIGHT)
    // Sequential batches by design: the bound is the point.
    digests.push(...(await Promise.all(batch.map((entry) => digest(deps, context, entry)))))
  }
  const read = digests.filter((entry) => entry !== undefined)

  const viewsIn = new Map(viewsByWorkspace.map(({ workspaceId, views }) => [workspaceId, views]))
  const engagementOf = (entry: WorkspaceDigest): number =>
    (viewsIn.get(entry.stats.workspaceId) ?? 0) + entry.createdRecently

  const hasHistory = viewsByWorkspace.length > 0 || read.some((entry) => entry.createdRecently > 0)
  const scope = command.scope ?? (hasHistory ? 'mine' : 'everywhere')
  const recent = newest(
    scope === 'everywhere'
      ? read.flatMap((entry) => entry.published)
      : read.filter((entry) => engagementOf(entry) > 0).flatMap((entry) => entry.publishedByOthers),
    command.recentLimit,
  )

  const stillOpenable = new Map(read.flatMap((entry) => entry.opened).map((row) => [row.id, row]))
  const jumpBackIn = opened
    .flatMap(({ documentId, lastViewedAt }) => {
      const row = stillOpenable.get(documentId)
      return row === undefined
        ? []
        : [
            {
              id: row.id,
              shortId: row.shortId,
              slug: row.slug,
              title: row.title,
              workspaceId: row.workspaceId,
              viewedAt: lastViewedAt,
            },
          ]
    })
    .slice(0, JUMP_BACK_IN_LIMIT)

  return {
    workspaces,
    stats: read.map((entry) => ({ ...entry.stats, engagement: engagementOf(entry) })),
    drafts: {
      total: read.reduce((sum, entry) => sum + entry.ownDraftCount, 0),
      items: newest(
        read.flatMap((entry) => entry.ownDrafts),
        command.draftLimit,
      ),
    },
    recent: await withEditors(users, recent),
    jumpBackIn,
    scope,
    hasHistory,
    anyPublished: read.some((entry) => entry.publishedCount > 0),
  }
}

/** Names the editors of the few changes that are shown, in one read. */
async function withEditors(
  users: UserRepository,
  changes: readonly PublishedChange[],
): Promise<HomeRecentDocument[]> {
  const ids = [...new Set(changes.flatMap((change) => change.updatedBy ?? []))]
  const names = new Map(
    (await users.listByIds(ids)).map((user) => [user.id, user.displayName] as const),
  )
  return changes.map(({ updatedBy, ...document }) => {
    const name = updatedBy === null ? undefined : names.get(updatedBy)
    return {
      ...document,
      updatedBy: updatedBy === null || name === undefined ? null : { id: updatedBy, name },
    }
  })
}
