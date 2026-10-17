/**
 * What a link preview is (ADR-042): plain data, shared by the server that
 * makes one and the web app that draws it.
 *
 * Every text field was untrusted when it arrived and has been cleaned (trimmed,
 * length-capped, stripped of control characters) before it got here; nothing
 * in a preview is markup, and nothing in it is a remote URL to load, because
 * images are held by us and referenced by hash.
 */

export const LINK_PREVIEW_KINDS = [
  'website',
  'article',
  'video',
  'audio',
  'image',
  'profile',
  'repository',
  'issue',
] as const

export type LinkPreviewKind = (typeof LINK_PREVIEW_KINDS)[number]

/** Which layer answered: the "where did this come from" of a stale or wrong preview. */
export const LINK_PREVIEW_LAYERS = [
  'connector',
  'oembed',
  'open-graph',
  'twitter-card',
  'page',
] as const

export type LinkPreviewLayer = (typeof LINK_PREVIEW_LAYERS)[number]

/** An image Quill holds, addressed by the hash of its stored bytes. */
export interface PreviewImage {
  readonly hash: string
  readonly width: number
  readonly height: number
  readonly mediaType: string
}

/** How a status reads: the same five tones the rest of the product uses. */
export const PREVIEW_TONES = ['neutral', 'accent', 'success', 'warning', 'danger'] as const
export type PreviewTone = (typeof PREVIEW_TONES)[number]

/**
 * The state of the thing a link points at, from a connector (ADR-042, layer 1):
 * "Open", "Merged", "In review". Plain data; the tone is how it is coloured, and
 * is never the only thing that says it (the label always does).
 */
export interface PreviewStatus {
  readonly label: string
  readonly tone: PreviewTone
}

/**
 * A live embed an allowlisted provider offers for the page (ADR-042, "Embeds are
 * an allowlist"). `src` is the frame's address, already checked against the
 * allowlist when the preview was made, and `aspectRatio` (width over height)
 * lets the frame hold its place before it loads.
 */
export interface PreviewEmbed {
  readonly provider: string
  readonly src: string
  readonly aspectRatio: number
}

/** What a link to a file (rather than a page) is: shown as a file card or, for a picture, inline. */
export interface PreviewFile {
  readonly mediaType: string
  /** Null when the host did not say. */
  readonly bytes: number | null
  readonly name: string | null
}

/** The most lines a code snippet carries, and the longest a line may be: a preview, not a mirror. */
export const CODE_SNIPPET_MAX_LINES = 30
export const CODE_SNIPPET_MAX_LINE_LENGTH = 240

/**
 * Lines of source a link points at (a code permalink), from a connector. Plain text only:
 * each line is data to be escaped and shown, never markup, and never highlighted by a script.
 */
export interface PreviewCode {
  /** A language name for styling, lower case (`typescript`), or null when it is not known. */
  readonly language: string | null
  /** The 1-based number of the first line in `lines`. */
  readonly startLine: number
  readonly lines: readonly string[]
  /** The file's path within the repository. */
  readonly path: string
  /** The repository, as `owner/name`. */
  readonly repository: string
}

export interface LinkPreview {
  /** The normalised URL; the key the preview is stored and looked up by. */
  readonly url: string
  /** The page's own claim to its address, when it made one on the same site; else `url`. */
  readonly canonicalUrl: string
  readonly title: string
  readonly description: string | null
  readonly siteName: string | null
  readonly kind: LinkPreviewKind
  readonly thumbnail: PreviewImage | null
  readonly favicon: PreviewImage | null
  readonly layer: LinkPreviewLayer
  /** ISO 8601, UTC. */
  readonly fetchedAt: string
  /** Added by a connector; absent for a page. Optional, so a stored preview without it still reads (ADR-033). */
  readonly status?: PreviewStatus
  /** Present only when the provider is on the embed allowlist. */
  readonly embed?: PreviewEmbed
  /** Present when the link is a file and not a page. */
  readonly file?: PreviewFile
  /** Present when the link is a permalink to lines of source. Optional, so older stored previews still read. */
  readonly code?: PreviewCode
}

/**
 * Why no preview could be made. Each is an expected outcome rather than a bug,
 * and each is what a negative cache entry records: a link that yields nothing
 * is shown as a plain link, and not retried for an hour.
 */
export const LINK_PREVIEW_FAILURES = [
  /** Not a URL a preview can be made for. */
  'invalid_url',
  /** The host could not be reached, refused us, or took too long. */
  'unreachable',
  /** It answered, but with something that is not a page: a download, a 404. */
  'not_a_page',
  /** A page, but one that says nothing about itself. */
  'no_metadata',
  /**
   * A connector found the thing, and it is not public. A preview made with the instance's
   * credentials would show it to people who could not open it, so none is made; and any
   * preview kept from when it was public is dropped (ADR-042, "Private content").
   */
  'restricted',
  /** The organisation's policy does not let Quill contact it, or previews are off. */
  'blocked',
  /**
   * Quill had too many fetches in flight to take this one. Unlike every other
   * failure it says nothing about the link, so it is never cached: the next
   * request tries again.
   */
  'busy',
] as const

export type LinkPreviewFailure = (typeof LINK_PREVIEW_FAILURES)[number]
