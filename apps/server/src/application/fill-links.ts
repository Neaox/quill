import { createHash } from 'node:crypto'

import {
  firstParagraph,
  getLinkPreviews,
  peekLinkPreviews,
  readInternalLinkPreviews,
  renderDocument,
} from '@quill/application'
import type {
  InternalLinkDependencies,
  InternalLinkViewer,
  LinkPreviewDependencies,
  LinkPreviewFetchDependencies,
  LinkPreviewReading,
} from '@quill/application'
import { DEFAULT_LINK_DISPLAY, isInternalAddress } from '@quill/domain'
import type { EmbedRegistry, LinkDisplay, LinkPreviewView, UserId } from '@quill/domain'
import { scanLinkSlots } from '@quill/markdown'

import type { AppDependencies } from '../dependencies.ts'
import { linkDefaultDisplay } from './link-settings.ts'

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

/** What drawing a body needs beyond reading previews: how a link its author chose nothing for looks. */
export interface LinkFillDependencies extends LinkPreviewDependencies {
  /** The organisation's default display. Absent, the shipped default. */
  readonly defaultDisplay?: () => Promise<LinkDisplay>
}

/** The shared dependencies, the three ports the composition root chose, and the organisation's default display. */
export function linkPreviewDependencies(
  deps: AppDependencies,
): LinkPreviewFetchDependencies & LinkFillDependencies {
  return {
    uow: deps.uow,
    clock: deps.clock,
    ids: deps.ids,
    ...deps.linkPreviewPorts,
    defaultDisplay: () => linkDefaultDisplay(deps.settings),
  }
}

/**
 * What a reader may see of the documents a body links to (ADR-042, "Internal
 * links"): the dependencies that look them up and the reader they are looked
 * up for. Required of every fill, so a caller cannot forget to say who is reading.
 */
export interface InternalLinks {
  readonly deps: InternalLinkDependencies
  readonly viewer: InternalLinkViewer
}

/** Links to documents, read for this viewer; a description is the target's first paragraph, rendered from the cache. */
export function internalLinks(deps: AppDependencies, viewer: InternalLinkViewer): InternalLinks {
  return {
    viewer,
    deps: {
      uow: deps.uow,
      describe: async (documentId) => {
        const rendered = await renderDocument(deps, { documentId, indexLinks: false })
        return rendered.kind === 'rendered' ? firstParagraph(rendered.content.text) : null
      },
    },
  }
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
  deps: LinkFillDependencies,
  html: string,
  read: Read,
  countPending: boolean,
  embeds: EmbedRegistry,
  internal: InternalLinks,
): Promise<FilledBody> {
  const slots = scanLinkSlots(html)
  if (slots.keys.length === 0) return { html, pending: 0 }

  const defaultDisplay = await (deps.defaultDisplay?.() ?? DEFAULT_LINK_DISPLAY)

  // A link to a document of this instance is answered for the reader, by id, and never stored or
  // fetched; every other link is read from the snapshots.
  const documentKeys = slots.keys.filter(isInternalAddress)
  const pageKeys = slots.keys.filter((key) => !isInternalAddress(key))
  const [readings, documentViews] = await Promise.all([
    pageKeys.length === 0 ? [] : read(pageKeys),
    readInternalLinkPreviews(internal.deps, {
      viewer: internal.viewer,
      keys: documentKeys,
      described: new Set(slots.describedKeys(defaultDisplay)),
    }),
  ])
  const views = new Map<string, LinkPreviewView>(documentViews)
  for (const { key, view } of readings) if (key !== null) views.set(key, view)

  return {
    html: slots.draw(views, { defaultDisplay, imageUrl, embeds }),
    // An anonymous reader has no one to wait for: nothing was queued on their behalf.
    pending: countPending ? readings.filter(({ view }) => view.state === 'pending').length : 0,
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
  deps: LinkFillDependencies,
  userId: UserId,
  html: string,
  embeds: EmbedRegistry,
  internal: InternalLinks,
): Promise<FilledBody> {
  return fill(deps, html, (urls) => getLinkPreviews(deps, { userId, urls }), true, embeds, internal)
}

/** For anyone else: stored previews are drawn, and nothing is ever queued. */
export function fillLinksForPublic(
  deps: LinkFillDependencies,
  html: string,
  embeds: EmbedRegistry,
  internal: InternalLinks,
): Promise<FilledBody> {
  return fill(
    deps,
    html,
    async (urls) => peekLinkPreviews(deps, { audience: await deps.audiences.forPublic(), urls }),
    false,
    embeds,
    internal,
  )
}
