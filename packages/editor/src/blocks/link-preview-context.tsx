import type { LinkDisplay } from '@quill/markdown'
import { createContext, useContext } from 'react'

/**
 * What the application knows about the page a link goes to, for the card the
 * editor draws (ADR-042).
 *
 * The editor makes no requests of its own, so a card cannot go and fetch its
 * preview: the application hands over a way to look one up, the same way it hands
 * over the child documents (`child-documents-context.tsx`). A card says which
 * address it needs (`request`) and reads what is known (`preview`); the value
 * changes as previews arrive, which redraws the cards. It travels by context
 * because the card is drawn deep inside the editor's own tree by TipTap, where no
 * prop of `DocumentEditor` can reach. Without a source the card is drawn from the
 * address alone, which is also what it looks like until a preview has arrived.
 */

export interface EditorLinkPreview {
  readonly title: string
  readonly description: string | null
  readonly siteName: string | null
  readonly thumbnail: EditorLinkImage | null
  readonly favicon: EditorLinkImage | null
  /** Which layer answered (`connector`, `oembed`, `open-graph`, `twitter-card`, `page`); for the toolbar's status line. */
  readonly layer?: string | undefined
  /** When the page was fetched, as an ISO moment. */
  readonly fetchedAt?: string | undefined
}

export interface EditorLinkImage {
  readonly hash: string
  readonly width: number
  readonly height: number
}

/** Where a stored picture is served from. */
export type LinkImageUrl = (image: EditorLinkImage) => string

/** Where the answer for an address stands: what the toolbar's status line says. */
export type LinkPreviewState = 'ready' | 'pending' | 'unavailable' | 'blocked'

/**
 * How asking for a fresh fetch went. `started` means it is on its way; the
 * others are answers the author is told quietly, never errors in the page.
 */
export type LinkRefreshOutcome = 'started' | 'rate_limited' | 'blocked' | 'failed'

export interface LinkPreviewSource {
  /** The preview for an address, or null while there is none (still coming, blocked, unavailable). */
  preview(url: string): EditorLinkPreview | null
  /** Says that a card is showing this address, so the application finds out about it. */
  request(url: string): void
  readonly imageUrl: LinkImageUrl
  /**
   * Where the answer for an address stands, or null while nobody has asked yet.
   * Absent when the application cannot say, and then the toolbar has no status line.
   */
  state?(url: string): LinkPreviewState | null
  /** Asks for a fresh fetch. Never rejects: how it went is the answer. Absent when refreshing is not offered. */
  refresh?(url: string): Promise<LinkRefreshOutcome>
  /** True while a refresh is in flight. */
  readonly refreshing?: boolean | undefined
  /** What a link looks like when its author chose nothing: the organisation's default. */
  readonly defaultDisplay?: LinkDisplay | undefined
  /** False when the organisation draws no previews on the public site and share links. */
  readonly publicSite?: boolean | undefined
}

/** No lookup at all: every card is drawn from its address. */
export const NO_LINK_PREVIEWS: LinkPreviewSource = {
  preview: () => null,
  request: () => undefined,
  imageUrl: () => '',
}

const LinkPreviewContext = createContext<LinkPreviewSource>(NO_LINK_PREVIEWS)

export const LinkPreviewProvider = LinkPreviewContext.Provider

export function useLinkPreviewSource(): LinkPreviewSource {
  return useContext(LinkPreviewContext)
}
