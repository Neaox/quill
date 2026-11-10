import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { toast, type ToastId } from '@quill/ui'

import { queryKeys, useSourceFreshness } from '../../lib/api/index.ts'

/**
 * Offers the reader of a document read from a repository the newer version
 * when it lands, and never swaps it in under them (ADR-061, "Freshness";
 * `docs/ideas/external-git-sources.md`, "Prompt to reload").
 *
 * The page asks `GET …/source-freshness` when it opens — which is also what
 * starts the check on read on the server — and again every quarter-minute
 * while the tab is in front. What it hears drives one promise toast
 * (`docs/design/feedback.md`):
 *
 * - **A sync is under way:** "Updating from the source repository".
 * - **The document is at a newer revision than the one on screen:** the toast
 *   settles to "Updated from the repository" with one action, Reload. Reload
 *   refetches the document's queries; nothing is refetched until it is
 *   pressed, so a reader in the middle of a sentence or a selection keeps it.
 * - **The sync ends and this document did not change:** the toast settles to
 *   "Already up to date". A sync that failed reads the same way: a reader
 *   sees the page it was rendered from, never an error (ADR-061).
 *
 * It is the synchronisation with an external system an effect is for (rule
 * 6): the toast is outside React, and nothing here sets React state.
 */
export function useSourceReloadOffer(options: {
  readonly documentId: string
  /** Whether the document's workspace reads from a repository. */
  readonly sourced: boolean
  /** Whether the head is on screen; an older revision or a comparison is never offered a reload. */
  readonly readingHead: boolean
  /** The revision on screen. */
  readonly revision: string | null
  /** The document's workspace, whose live stream says sooner when it moves (ADR-063). */
  readonly workspaceId?: string | undefined
}): void {
  const { documentId, sourced, readingHead, revision, workspaceId } = options
  const queryClient = useQueryClient()
  const freshness = useSourceFreshness(documentId, sourced && readingHead, workspaceId)
  const pending = useRef<{
    readonly id: ToastId
    readonly settle: (outcome: 'updated' | 'current') => void
  } | null>(null)
  // The revision a reload has been offered for, so it is offered once.
  const offered = useRef<string | null>(null)

  const latest = freshness.data
  const syncing = latest?.syncing === true
  const latestRevision = latest?.revision ?? null
  const moved = latestRevision !== null && revision !== null && latestRevision !== revision

  // Synchronises with the toast host, which is outside React: what the
  // server says about the document becomes one promise toast.
  useEffect(() => {
    if (!sourced || !readingHead) return
    const reload = () => {
      for (const queryKey of [
        queryKeys.document(documentId),
        queryKeys.envelope(documentId),
        queryKeys.history(documentId),
        queryKeys.rendered(documentId),
      ]) {
        void queryClient.invalidateQueries({ queryKey })
      }
    }
    const begin = () => {
      const { promise: outcome, resolve: settle } = Promise.withResolvers<'updated' | 'current'>()
      const id = toast.promise(outcome, {
        loading: 'Updating from the source repository',
        success: (result) =>
          result === 'updated'
            ? {
                title: 'Updated from the repository',
                action: { label: 'Reload', onClick: reload },
              }
            : 'Already up to date',
        /* v8 ignore next -- the outcome is only ever resolved. */
        error: 'Could not update from the repository',
      })
      pending.current = { id, settle }
      return pending.current
    }

    if (moved && offered.current !== latestRevision) {
      offered.current = latestRevision
      const current = pending.current ?? begin()
      current.settle('updated')
      pending.current = null
      return
    }
    if (syncing && pending.current === null && !moved) {
      begin()
      return
    }
    if (!syncing && pending.current !== null) {
      pending.current.settle('current')
      pending.current = null
    }
  }, [documentId, latestRevision, moved, queryClient, readingHead, sourced, syncing])
}
