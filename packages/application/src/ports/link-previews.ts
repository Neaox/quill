import type {
  CompiledLinkPolicy,
  LinkPreview,
  LinkPreviewFailure,
  Result,
  UserId,
} from '@quill/domain'

/**
 * What the link preview use cases need from outside (ADR-042).
 *
 * Three boundaries, each a port because each is something the application
 * must not know the shape of: fetching a stranger's page, deciding whose rules
 * apply, and the in-memory counters that protect other people's servers.
 */

/**
 * Turns a URL into a preview, by fetching. Slow, fallible, and done only in a
 * background job, never while someone waits. The adapter is the layered
 * resolver in `apps/server/src/infrastructure/link-preview`.
 */
export interface LinkPreviewResolver {
  resolve(
    url: string,
    options?: { readonly policy?: CompiledLinkPolicy },
  ): Promise<Result<LinkPreview, LinkPreviewFailure>>
}

/**
 * Whose rules a request is made under: an organisation's policy, and the scope
 * its snapshots are stored in.
 *
 * A preview fetched under the default policy is the same for everyone and is
 * stored in the shared `public` scope. A preview fetched under a *restrictive*
 * policy (an allow list, a block list, text-only) may differ, since an image
 * host may have been refused, so it is stored privately for that audience and
 * never handed to anyone else. This is what lets an organisation that limits
 * where Quill goes be certain Quill did not go there on its behalf, while
 * everyone else still shares one fetch.
 */
export interface LinkPreviewAudience {
  readonly scope: string
  readonly policy: CompiledLinkPolicy
}

export const PUBLIC_PREVIEW_SCOPE = 'public'

export interface LinkPreviewAudiences {
  forPerson(userId: UserId): Promise<LinkPreviewAudience>
  /**
   * Whom the public site and exports read for: nobody in particular, so the
   * default policy and the shared scope. Read-only; see `peekLinkPreviews`.
   */
  forPublic(): LinkPreviewAudience
}

/**
 * Courtesy and protection: how often Quill may ask one host, how often any
 * one audience may ask for anything, and how often one person may force a
 * refresh. Counters, not storage, so an implementation may be in-memory.
 */
export type RateDecision =
  | { readonly allowed: true }
  /** Not now; the earliest a token will be there, so the caller can wait exactly that long. */
  | { readonly allowed: false; readonly retryAfterMs: number }

export interface LinkPreviewRateLimits {
  /** Whether a fetch of a page on `host`, for `scope`, may start now. Takes the allowance if so. */
  allowFetch(input: { readonly host: string; readonly scope: string }): RateDecision
  /** Whether this person may force another refresh now. Takes the allowance if so. */
  allowRefresh(userId: UserId): boolean
  /** Whether this person may ask about another page of links now. Takes the allowance if so. */
  allowRead(userId: UserId): boolean
  /**
   * How many of `count` new fetches this person may queue now, taking that many
   * from their allowance. Asking about links is free; *causing a request to a
   * stranger's server* is what is rationed, so one person cannot fill the queue.
   */
  allowQueued(userId: UserId, count: number): number
}
