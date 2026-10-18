import type { LinkPreviewKind, LinkPreviewLayer } from '@quill/domain'

/**
 * What one layer found out about a URL, before images are fetched (ADR-042).
 *
 * Every layer answers in this one shape, so the resolver can compare them and
 * the image step can treat them alike. Text is already cleaned
 * (`plain-text.ts`), and `imageUrl` is an absolute `http(s)` URL that has been
 * resolved but not fetched: whether it is a real image is for the image
 * pipeline to find out.
 */
export interface PreviewDraft {
  readonly layer: LinkPreviewLayer
  readonly title: string | null
  readonly description: string | null
  readonly siteName: string | null
  readonly kind: LinkPreviewKind
  readonly imageUrl: string | null
  /** What the page claims as its own address, absolute; the resolver decides whether to believe it. */
  readonly canonicalUrl: string | null
}

/** A draft known to have a title, which is what every preview is built from. */
export type TitledDraft = PreviewDraft & { readonly title: string }

/** A draft worth showing as a card: a title, and something more than a title. */
export function isRich(draft: PreviewDraft): draft is TitledDraft {
  return draft.title !== null && (draft.description !== null || draft.imageUrl !== null)
}

/** Whether a draft is better than nothing: it at least has a title. */
export function hasTitle(draft: PreviewDraft): draft is TitledDraft {
  return draft.title !== null
}
