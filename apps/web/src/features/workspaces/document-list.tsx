import { Link } from '@tanstack/react-router'
import { useState } from 'react'

import { Badge, TREE_PAGE_SIZE, type BadgeTone } from '@quill/ui'

import { groupDocumentsByCollection } from '../../lib/documents/group-by-collection.ts'
import type { DocumentDto } from '../../lib/api/index.ts'

const STATUS_TONE: Readonly<Record<DocumentDto['status'], BadgeTone>> = {
  draft: 'neutral',
  published: 'accent',
  archived: 'warning',
}

export interface DocumentListProps {
  readonly workspaceSlug: string
  readonly documents: readonly DocumentDto[]
  /** Collection ids to names; see `useCollectionNames`. */
  readonly collectionNames?: ReadonlyMap<string, string> | undefined
  /** Collection ids in the workspace tree's order, so this page and the sidebar agree. */
  readonly collectionOrder?: readonly string[] | undefined
}

/**
 * The workspace home's main content: documents grouped by collection (task
 * requirement). Distinct markup from `WorkspaceTree`'s sidebar navigation —
 * this is the browsable landing view, not the persistent nav — but built
 * from the same `groupDocumentsByCollection`, so the grouping itself can
 * never disagree between the two.
 */
export function DocumentList({
  workspaceSlug,
  documents,
  collectionNames,
  collectionOrder,
}: DocumentListProps) {
  // How many of each group are drawn: a page, widened by "Show more". A
  // collection of twenty thousand is one page of links, not twenty thousand
  // (rule 13), the same paging the sidebar tree uses.
  const [shown, setShown] = useState<ReadonlyMap<string, number>>(() => new Map())

  if (documents.length === 0) {
    return <p className="text-sm text-muted">This workspace has no documents yet.</p>
  }

  const groups = groupDocumentsByCollection(documents, collectionNames, collectionOrder)

  return (
    <div className="flex flex-col gap-8">
      {groups.map((group) => {
        const key = group.collectionId ?? 'uncategorised'
        const limit = shown.get(key) ?? TREE_PAGE_SIZE
        const hidden = group.documents.length - limit
        return (
          <section
            key={group.collectionId ?? 'uncategorised'}
            aria-labelledby={`group-${group.collectionId ?? 'uncategorised'}`}
          >
            <h2
              id={`group-${group.collectionId ?? 'uncategorised'}`}
              className="text-xs font-semibold tracking-wide text-muted uppercase"
            >
              {group.label}
            </h2>
            <ul className="mt-3 flex flex-col divide-y divide-border rounded-lg border border-border">
              {group.documents.slice(0, limit).map((document) => (
                <li key={document.id}>
                  <Link
                    to="/w/$workspaceSlug/d/$documentId"
                    params={{ workspaceSlug, documentId: document.id }}
                    className="flex items-center justify-between gap-4 px-4 py-3 text-sm hover:bg-surface focus-visible:relative focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring"
                  >
                    <span className="truncate font-medium text-foreground">{document.title}</span>
                    <Badge tone={STATUS_TONE[document.status]}>{document.status}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
            {hidden <= 0 ? undefined : (
              <button
                type="button"
                className="mt-2 cursor-pointer rounded-md px-2 py-1 text-xs font-medium text-muted hover:bg-surface hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring"
                onClick={() => {
                  setShown(new Map(shown).set(key, limit + TREE_PAGE_SIZE))
                }}
              >
                {`Show ${Math.min(TREE_PAGE_SIZE, hidden).toLocaleString()} more`}
                <span className="font-normal">{` · ${hidden.toLocaleString()} not shown`}</span>
                <span className="sr-only">{` in ${group.label}`}</span>
              </button>
            )}
          </section>
        )
      })}
    </div>
  )
}
