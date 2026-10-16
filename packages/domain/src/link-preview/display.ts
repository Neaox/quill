/**
 * How a link is shown (ADR-042, "Display: the author decides").
 *
 * The choice belongs to the author, is stored in the document, and is read the
 * same way by every reader on every surface, so the vocabulary lives here,
 * where the Markdown directive, the server's renderer, the editor's toolbar and
 * the reading components all see one definition.
 */

export const LINK_DISPLAYS = ['url', 'inline', 'compact', 'card', 'embed'] as const

/**
 * - `url`: the link as written, with no preview. Always the fallback.
 * - `inline`: favicon and title, in running text.
 * - `compact`: favicon, title and site on one line, as a block: for lists of references.
 * - `card`: title, description and thumbnail, as a block.
 * - `embed`: the live content in a sandboxed frame, for an allowlisted provider.
 */
export type LinkDisplay = (typeof LINK_DISPLAYS)[number]

export const CARD_LAYOUTS = ['side', 'top'] as const

/** `side`: the picture beside the words, compact (the default). `top`: a large picture above them. */
export type CardLayout = (typeof CARD_LAYOUTS)[number]

export const DEFAULT_CARD_LAYOUT: CardLayout = 'side'

/** Whether a display is a block of its own, which cannot sit in the middle of a line. */
export function isBlockDisplay(display: LinkDisplay): boolean {
  return display === 'card' || display === 'compact' || display === 'embed'
}

export function isLinkDisplay(value: unknown): value is LinkDisplay {
  return LINK_DISPLAYS.some((display) => display === value)
}

export function isCardLayout(value: unknown): value is CardLayout {
  return CARD_LAYOUTS.some((layout) => layout === value)
}

/**
 * What an author chose for one link, with every field optional because an
 * unchosen field is the organisation's or the default's to decide.
 */
export interface LinkChoice {
  /** `null` when the author did not choose: the organisation's default applies. */
  readonly display: LinkDisplay | null
  readonly layout: CardLayout
  /** False when the author dropped the thumbnail. */
  readonly showImage: boolean
  /** Replaces the fetched title. */
  readonly title: string | null
  /** Replaces the fetched description; the empty string hides it. */
  readonly description: string | null
}

export const UNCHOSEN: LinkChoice = {
  display: null,
  layout: DEFAULT_CARD_LAYOUT,
  showImage: true,
  title: null,
  description: null,
}

/** How a link with no stored choice is shown: favicon and title, quiet in running text. */
export const DEFAULT_LINK_DISPLAY: LinkDisplay = 'inline'
