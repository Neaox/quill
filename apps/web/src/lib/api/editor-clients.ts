import { useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'

import type {
  AcquireResult,
  DocumentAst,
  DraftClient,
  DraftSaveResult,
  HeartbeatResult,
  LoadedDraft,
  Lock,
  LockClient,
  LockHolder,
  TakeoverResult,
} from '@quill/editor'

import { readDraftContent, withDocumentAst, type DraftContent } from '../documents/draft-content.ts'
import { useApiClient } from './client-context.tsx'
import { draftQueryOptions, useSaveDraft } from './drafts.ts'
import { ApiError } from './errors.ts'
import { useAcquireLock, useHeartbeatLock, useReleaseLock, useTakeoverLock } from './locks.ts'
import { queryKeys } from './query-keys.ts'
import type { DraftDto, LockHolderDto } from './types.ts'

/**
 * The two ports `@quill/editor` declares, implemented over this
 * application's API layer (`docs/architecture/patterns.md`: ports and
 * adapters).
 *
 * The editor package makes no requests; it takes a `DraftClient` and a
 * `LockClient` whose results are the ADR-021 contract table as a
 * discriminated union, one member per status code. This is the only place
 * those status codes are read: `423 lock_lost` means stop and recover,
 * `409 stale_version` means re-read and retry, `401 session_expired` means
 * the session is gone — three outcomes the editor must tell apart without
 * parsing a body, exactly as the ADR insists.
 *
 * Both clients are built from the existing mutation hooks, so a lock
 * acquire from the editor invalidates the same cache entries an acquire from
 * anywhere else would. `mutateAsync` is referentially stable for the life of
 * a `useMutation`, which is what lets these be memoised: the editor's hooks
 * hold their client in an effect dependency, and a client that changed
 * identity on every render would release and re-acquire the lock forever.
 */

/**
 * ADR-021's lock endpoints report *who* holds a lock as a user id and never
 * as a name; the live envelope (ADR-031) is where a name comes from. So the
 * adapter fills in a truthful placeholder and the editor route prefers
 * `envelope.lock.holderName` wherever it has one to show.
 */
const UNNAMED_HOLDER = 'Another editor'

function isLockHolderDto(value: unknown): value is LockHolderDto {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as { holderUserId?: unknown; expiresAt?: unknown }
  return typeof candidate.holderUserId === 'string' && typeof candidate.expiresAt === 'string'
}

/** Reads `details.holder` off an `ApiError`, naming the holder where the caller knows it. */
function holderFrom(details: unknown, displayName: string): LockHolder | null {
  const holder = (details as { holder?: unknown } | null | undefined)?.holder
  if (!isLockHolderDto(holder)) return null
  return {
    userId: holder.holderUserId,
    displayName,
    expiresAt: Date.parse(holder.expiresAt),
  }
}

function toLock(lock: LockHolderDto): Lock {
  return {
    holderUserId: lock.holderUserId,
    holderSessionId: lock.holderSessionId,
    expiresAt: Date.parse(lock.expiresAt),
  }
}

function currentVersionFrom(details: unknown): number {
  const version = (details as { currentVersion?: unknown } | null | undefined)?.currentVersion
  // A stale-version conflict the server could not quantify is still stale;
  // reporting version 0 makes the editor re-read, which is the right move.
  return typeof version === 'number' ? version : 0
}

/** Rethrows anything that is not a documented outcome of this call. */
function asApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error
  throw error
}

export function useLockClient(documentId: string): LockClient {
  const { mutateAsync: acquireLock } = useAcquireLock()
  const { mutateAsync: sendHeartbeat } = useHeartbeatLock()
  const { mutateAsync: releaseLock } = useReleaseLock()
  const { mutateAsync: takeoverLock } = useTakeoverLock()

  return useMemo<LockClient>(
    () => ({
      async acquire(): Promise<AcquireResult> {
        try {
          const result = await acquireLock(documentId)
          return { status: 'acquired', lock: toLock(result.lock) }
        } catch (error) {
          const failure = asApiError(error)
          const holder = holderFrom(failure.details, UNNAMED_HOLDER)
          if (failure.status === 409 && holder !== null) return { status: 'held', holder }
          throw failure
        }
      },

      async heartbeat(): Promise<HeartbeatResult> {
        try {
          const result = await sendHeartbeat(documentId)
          return { status: 'alive', expiresAt: Date.parse(result.expiresAt) }
        } catch (error) {
          const failure = asApiError(error)
          if (failure.status === 410) return { status: 'expired' }
          if (failure.status === 404) return { status: 'released' }
          const holder = holderFrom(failure.details, UNNAMED_HOLDER)
          if (failure.status === 409 && holder !== null) return { status: 'taken_over', holder }
          throw failure
        }
      },

      async release(): Promise<void> {
        await releaseLock(documentId)
      },

      async takeover(): Promise<TakeoverResult> {
        try {
          const result = await takeoverLock(documentId)
          return { status: 'acquired', lock: toLock(result.lock) }
        } catch (error) {
          const failure = asApiError(error)
          if (failure.status === 403) return { status: 'forbidden' }
          throw failure
        }
      },
    }),
    [documentId, acquireLock, sendHeartbeat, releaseLock, takeoverLock],
  )
}

/**
 * A draft this release cannot read is a forward-compatibility stop, not a
 * bug: ADR-033 requires every reader of a persisted format to dispatch on its
 * version and to say so rather than guess.
 */
const UNREADABLE_DRAFT = 'This draft was written by a newer version of the platform'

export function useDraftClient(documentId: string): DraftClient {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()
  const { mutateAsync: saveDraft } = useSaveDraft()

  return useMemo<DraftClient>(() => {
    /**
     * The draft envelope as it stands, from the cache when it is there and
     * from the server when it is not. A save has to carry the version and the
     * front matter back unchanged; the editor only ever handled the tree.
     */
    async function currentContent(): Promise<DraftContent> {
      const cached = readDraftContent(
        queryClient.getQueryData<DraftDto>(queryKeys.draft(documentId))?.ast,
      )
      if (cached !== null) return cached
      const fresh = await queryClient.fetchQuery(draftQueryOptions(apiClient, documentId))
      const content = readDraftContent(fresh.ast)
      if (content === null) throw new Error(UNREADABLE_DRAFT)
      return content
    }

    return {
      async load(): Promise<LoadedDraft> {
        // Through the query cache rather than a bare request, so the re-read
        // after a stale-version conflict updates the same entry the route
        // rendered from.
        const draft = await queryClient.fetchQuery(draftQueryOptions(apiClient, documentId))
        const content = readDraftContent(draft.ast)
        if (content === null) throw new Error(UNREADABLE_DRAFT)
        return {
          ast: content.ast as DocumentAst,
          draftVersion: draft.draftVersion,
          baseRevision: draft.baseRevision,
        }
      },

      async save(ast: DocumentAst, expectedVersion: number): Promise<DraftSaveResult> {
        try {
          const result = await saveDraft({
            documentId,
            ast: withDocumentAst(await currentContent(), ast),
            expectedVersion,
          })
          return {
            status: 'saved',
            draftVersion: result.draftVersion,
            updatedAt: Date.parse(result.updatedAt),
          }
        } catch (error) {
          const failure = asApiError(error)
          switch (failure.status) {
            case 423:
              return { status: 'lock_lost', holder: holderFrom(failure.details, UNNAMED_HOLDER) }
            case 409:
              return {
                status: 'stale_version',
                currentVersion: currentVersionFrom(failure.details),
              }
            case 401:
              return { status: 'session_expired' }
            default:
              throw failure
          }
        }
      },
    }
  }, [apiClient, documentId, queryClient, saveDraft])
}
