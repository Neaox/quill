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
  /** Which layer answered; `internal` is another document of this instance, drawn with a document's icon. */
  readonly layer?: string | undefined
  /** Present when the link is a file rather than a page: drawn with an icon for its type, its type and size. */
  readonly file?: EditorLinkFile | undefined
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
