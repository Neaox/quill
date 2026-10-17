import { createHash } from 'node:crypto'

import { getLinkPreviews, peekLinkPreviews } from '@quill/application'
import type {
  LinkPreviewDependencies,
  LinkPreviewFetchDependencies,
  LinkPreviewReading,
} from '@quill/application'
import { DEFAULT_LINK_DISPLAY } from '@quill/domain'
import type { EmbedRegistry, LinkPreviewView, UserId } from '@quill/domain'
import { scanLinkSlots } from '@quill/markdown'

import type { AppDependencies } from '../dependencies.ts'

/**
 * Link previews drawn into a rendered body (ADR-042, ADR-031).
 *
 * The cached body holds only slots: plain anchors that carry what the author
 * chose. The previews are read per request, in one batch, and drawn into the
 * slots here. A link with no preview yet stays the plain link it already is,
 * so a slow or failed preview can never make a page worse than no previews.
 *
 * The two entry points differ in exactly one way, and it is a security
 * property: a signed-in member's read *queues* fetches for links nobody has
 * previewed, and an anonymous read never does (`peekLinkPreviews`), so a
 * stranger cannot make Quill request an address by asking for a page.
 */

/** The shared dependencies plus the three ports the composition root chose. */
export function linkPreviewDependencies(deps: AppDependencies): LinkPreviewFetchDependencies {
  return { uow: deps.uow, clock: deps.clock, ids: deps.ids, ...deps.linkPreviewPorts }
}

export interface FilledBody {
  readonly html: string
  /** Links whose preview is on its way, so a client knows to look again shortly. */
  readonly pending: number
}

type Read = (keys: readonly string[]) => Promise<readonly LinkPreviewReading[]>

/** The address a stored picture is served from; see `routes/link-preview-images.ts`. */
const imageUrl = (image: { readonly hash: string }) => `/link-previews/images/${image.hash}`

async function fill(
  html: string,
  read: Read,
  countPending: boolean,
  embeds: EmbedRegistry,
): Promise<FilledBody> {
  const slots = scanLinkSlots(html)
  if (slots.keys.length === 0) return { html, pending: 0 }

  const readings = await read(slots.keys)
  const views = new Map<string, LinkPreviewView>()
  for (const { key, view } of readings) if (key !== null) views.set(key, view)

  return {
    html: slots.draw(views, { defaultDisplay: DEFAULT_LINK_DISPLAY, imageUrl, embeds }),
    // An anonymous reader has no one to wait for: nothing was queued on their behalf.
    pending: countPending
      ? [...views.values()].filter((view) => view.state === 'pending').length
      : 0,
  }
}

/**
 * The validator for a body with previews drawn into it. The cached body's key
 * is its whole identity only until something is drawn in; after that the tag
 * must also name what was drawn, so a preview that has since arrived is never
 * answered with a 304 for the plain link.
 */
export function drawnTag(key: string, body: string, filled: string): string {
  if (filled === body) return `"${key}"`
  return `"${key}-${createHash('sha256').update(filled).digest('base64url').slice(0, 16)}"`
}

/** For a signed-in member: stored previews are drawn, and links without one are queued. */
export function fillLinksForMember(
  deps: LinkPreviewDependencies,
  userId: UserId,
  html: string,
  embeds: EmbedRegistry,
): Promise<FilledBody> {
  return fill(html, (urls) => getLinkPreviews(deps, { userId, urls }), true, embeds)
}

/** For anyone else: stored previews are drawn, and nothing is ever queued. */
export function fillLinksForPublic(
  deps: LinkPreviewDependencies,
  html: string,
  embeds: EmbedRegistry,
): Promise<FilledBody> {
  return fill(
    html,
    (urls) => peekLinkPreviews(deps, { audience: deps.audiences.forPublic(), urls }),
    false,
    embeds,
  )
}
