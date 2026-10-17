import {
  useAttention,
  useHomeSummary,
  type AttentionItem,
  type HomeScope,
  type HomeSummaryDto,
  type WorkspaceSummaryDto,
} from '../../lib/api/index.ts'
import { documentReference, workspaceReference } from '../../lib/routing/document-reference.ts'

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

/** A workspace's row: its facts come from the summary, and are absent until it has arrived. */
export interface HomeWorkspace {
  readonly workspace: WorkspaceSummaryDto
  /** The workspace's own address, for the link (ADR-035). */
  readonly reference: string
  /** `undefined` until the summary has arrived: a count is never guessed. */
  readonly documentCount: number | undefined
  readonly draftCount: number | undefined
  /** The newest change to any document in it, or `undefined` for none yet. */
  readonly updatedAt: string | undefined
  /** How much the person has been in it lately (opens and documents created); 0 for none. */
  readonly engagement: number
}

/** Something waiting on the person: a review asked of them, or an answer to one they asked. */
export interface HomeAttention {
  readonly requestId: string
  readonly kind: AttentionItem['kind']
  readonly by: string
  readonly at: string
  readonly document: HomeDocument
}

export interface HomeSections {
  /** Which places the feed covers, as the server applied it. */
  readonly scope: HomeScope | undefined
  /** The person has been in places of their own, so there is a choice between theirs and everyone's. */
  readonly hasHistory: boolean
  /** What they opened most recently, newest first. */
  readonly jumpBackIn: readonly HomeDocument[]
  /** What is waiting on them, newest first: the first thing the page says. */
  readonly attention: readonly HomeAttention[]
  /** The newest documents never published, newest first: what the person may pick back up. */
  readonly continueWith: readonly HomeDocument[]
  /** How many there are in all, which the section says when it shows fewer. */
  readonly draftTotal: number
  /** The newest published changes across every workspace. */
  readonly recentlyUpdated: readonly HomeDocument[]
  readonly workspaces: readonly HomeWorkspace[]
  /** Whether anything at all has been published yet — the set-up checklist's last step. */
  readonly anyPublished: boolean
  readonly isPending: boolean
  /** The summary could not be had; the workspaces are still listed, without figures. */
  readonly isError: boolean
  /** Asks for the summary again after it failed. */
  readonly retry: () => void
}

/**
 * The signed-in home's sections (`docs/design/home.md`).
 *
 * The server answers in one bounded request (`GET /api/home`): a row of
 * figures per workspace and the two short lists, already limited and already
 * restricted to what this person may open. That is what lets the page cost the
 * same for a team of five and an organisation of five hundred workspaces; it
 * used to fetch every workspace's whole document list and count in the
 * browser. Here the answer is only joined to the workspace list the rest of
 * the app shares, so a row can say its workspace's name and address.
 *
 * What it cannot say: whether a published document has a newer draft, or who
 * holds a lock — those are each document's envelope.
 */
export function useHomeSections(
  workspaces: readonly WorkspaceSummaryDto[],
  scope?: HomeScope,
): HomeSections {
  const summary = useHomeSummary(scope)
  const attention = useAttention()
  const data = summary.data
  const byId = new Map(workspaces.map((workspace) => [workspace.id, workspace]))
  const stats = new Map(data?.stats.map((row) => [row.workspaceId, row]))

  const row = (
    document: Pick<HomeSummaryDto['recent'][number], 'id' | 'shortId' | 'title' | 'workspaceId'> &
      Partial<Pick<HomeSummaryDto['recent'][number], 'updatedAt'>>,
  ): HomeDocument[] => {
    const workspace = byId.get(document.workspaceId)
    return workspace === undefined
      ? []
      : [
          {
            id: document.id,
            reference: documentReference(document),
            title: document.title,
            updatedAt: document.updatedAt ?? '',
            workspaceId: workspace.id,
            workspaceSlug: workspaceReference(workspace),
            workspaceName: workspace.name,
          },
        ]
  }

  return {
    attention:
      attention.data?.flatMap((item) =>
        row(item.document).map((document) => ({
          requestId: item.requestId,
          kind: item.kind,
          by: item.by.name,
          at: item.at,
          document: { ...document, updatedAt: item.at },
        })),
      ) ?? [],
    scope: data?.scope,
    hasHistory: data?.hasHistory ?? false,
    jumpBackIn:
      data?.jumpBackIn.flatMap((item) =>
        row(item).map((document) => ({ ...document, updatedAt: item.viewedAt })),
      ) ?? [],
    continueWith: data?.drafts.items.flatMap(row) ?? [],
    draftTotal: data?.drafts.total ?? 0,
    recentlyUpdated: data?.recent.flatMap(row) ?? [],
    workspaces: workspaces.map((workspace): HomeWorkspace => {
      const figures = stats.get(workspace.id)
      return {
        workspace,
        reference: workspaceReference(workspace),
        documentCount: figures?.documentCount,
        draftCount: figures?.draftCount,
        updatedAt: figures?.updatedAt ?? undefined,
        engagement: figures?.engagement ?? 0,
      }
    }),
    anyPublished: data?.anyPublished ?? false,
    isPending: summary.isPending,
    isError: summary.isError,
    retry: () => {
      void summary.refetch()
    },
  }
}
