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
}

export interface EditorLinkEmbed {
  /** What a reader calls the provider: "YouTube". */
  readonly provider: string
  /** Width over height. */
  readonly aspectRatio: number
}

export interface EditorLinkImage {
  readonly hash: string
  readonly width: number
  readonly height: number
}

/** Where a stored picture is served from. */
export type LinkImageUrl = (image: EditorLinkImage) => string

export interface LinkPreviewSource {
  /** The preview for an address, or null while there is none (still coming, blocked, unavailable). */
  preview(url: string): EditorLinkPreview | null
  /** Says that a card is showing this address, so the application finds out about it. */
  request(url: string): void
  readonly imageUrl: LinkImageUrl
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
