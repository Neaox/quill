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
  /**
   * Present when the page can be embedded, so the editor offers `Embed` for it and draws the
   * embed's place. The editor never loads the frame: this is only enough to name it and size it.
   */
  readonly embed?: EditorLinkEmbed
  /** From a connector: "Open", "Merged". Optional, so a source that has none still fits. */
  readonly status?: EditorLinkStatus | undefined
  /** From a connector, for a permalink to lines of source. */
  readonly code?: EditorLinkCode | undefined
  /** Present when the link is a file rather than a page: drawn with an icon for its type, its type and size. */
  readonly file?: EditorLinkFile | undefined
  /** Which layer answered (`internal`, `connector`, `oembed`, `open-graph`, `twitter-card`, `page`); `internal` is another document of this instance, drawn with a document's icon, and the layer feeds the toolbar's status line. */
  readonly layer?: string | undefined
  /** When the page was fetched, as an ISO moment. */
  readonly fetchedAt?: string | undefined
}

export interface EditorLinkStatus {
  readonly label: string
  readonly tone: 'neutral' | 'accent' | 'success' | 'warning' | 'danger'
}

export interface EditorLinkCode {
  readonly language: string | null
  readonly startLine: number
  readonly lines: readonly string[]
  readonly path: string
  readonly repository: string
}

export interface EditorLinkEmbed {
  /** What a reader calls the provider: "YouTube". */
  readonly provider: string
  /** Width over height. */
  readonly aspectRatio: number
}

export interface EditorLinkFile {
  readonly mediaType: string
  /** Null when the host did not say. */
  readonly bytes: number | null
  readonly name: string | null
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
