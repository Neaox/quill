import type { DocumentId } from '@quill/domain'

/**
 * The Markdown pipeline as a port (ADR-002, ADR-004, ADR-029, ADR-031).
 *
 * `packages/markdown` is where a document is parsed, checked, rendered, and
 * written back, and it is infrastructure to this layer in the same way the
 * content store is: the use cases below describe what they need of it and the
 * server composes the implementation, with the highlighter (ADR-030) already
 * bound in. That keeps the application layer free of grammars, of an mdast
 * dependency, and of anything a test would have to stand up to exercise a
 * publish.
 */

/**
 * A document tree, opaque above `packages/markdown`.
 *
 * Nothing in this layer reads inside it: use cases carry it from a draft to
 * the formatter and back, which is exactly as much as they need to know.
 */
export type DocumentAst = unknown

/** The version stamped into every draft this platform writes (ADR-033). */
export const DRAFT_CONTENT_VERSION = 1

/**
 * What a draft row holds. Versioned because it is a persisted format, and
 * every reader dispatches on the version rather than assuming the current
 * shape.
 */
export interface DraftContent {
  readonly version: number
  readonly frontMatter: Record<string, unknown>
  readonly ast: DocumentAst
}

/**
 * Something the author should know about, never a reason to refuse a publish.
 *
 * A warning always says what it is about — which placeholder, which question —
 * because a summary that only names a code helps nobody.
 */
export interface FormatWarning {
  readonly code: string
  readonly detail: string
}

/** A front-matter field that does not match the schema. Reported, never discarded (ADR-005). */
export interface FrontMatterIssue {
  readonly path: string
  readonly message: string
}

export interface TemplateSource {
  /** The template document's published Markdown, front matter and all. */
  readonly markdown: string
  readonly answers: Readonly<Record<string, unknown>>
}

export interface CreateDocumentContentInput {
  readonly documentId: DocumentId
  readonly title: string
  /** Absent for a blank document. */
  readonly template?: TemplateSource | undefined
}

export interface NewDocumentContent {
  readonly content: DraftContent
  /**
   * The headings the template marks required, after its conditions are
   * evaluated. Recorded on the document and shown; never enforced (ADR-029).
   */
  readonly requiredSections: readonly string[]
  readonly warnings: readonly FormatWarning[]
}

export interface PreparePublishInput {
  readonly documentId: DocumentId
  readonly content: DraftContent
}

/** A draft turned into the Markdown a publish writes. */
export interface PublishableDocument {
  readonly markdown: string
  readonly frontMatter: Record<string, unknown>
  /** The document's own title, from front matter or its first heading. */
  readonly title: string | undefined
  /** Placeholders that survived to publish (ADR-029). */
  readonly warnings: readonly FormatWarning[]
  readonly frontMatterIssues: readonly FrontMatterIssue[]
  /** Required headings that hold nothing once authoring scaffolding is removed. */
  readonly incompleteRequiredSections: readonly string[]
}

export interface RetitleInput {
  readonly content: DraftContent
  readonly title: string
}

export interface OutlineEntry {
  readonly id: string
  readonly depth: number
  readonly text: string
  readonly children: readonly OutlineEntry[]
}

export interface ExtractedText {
  readonly title: string | undefined
  readonly headings: readonly string[]
  readonly body: string
}

export interface ExtractedLink {
  readonly kind: 'link' | 'image'
  readonly url: string
  readonly text: string
  readonly external: boolean
}

/**
 * The version stamped into every render-cache entry this platform writes
 * (ADR-033). Version 2 is the first whose bodies carry the syntax-token
 * ranges the client applies and whose key covers the titles of the documents
 * a body links to; version 1 entries stay readable and are never served.
 */
export const RENDERED_CONTENT_VERSION = 2

/**
 * Everything the rendered body is a function of (ADR-031).
 *
 * The Markdown is the whole of it but for one thing: a link to another
 * document is written as a canonical id URL and shown under that document's
 * current title, so the titles it points at are an input to the render and
 * not a property of now. Passing them in is what keeps the body a pure
 * function of its input — the cache key covers them, so renaming a document
 * this one links to produces a new key rather than an entry to invalidate.
 */
export interface RenderInput {
  readonly markdown: string
  /** The current title of each document this body links to, by id. */
  readonly linkTitles: ReadonlyMap<DocumentId, string>
}

/**
 * The static body of a document: a pure function of its Markdown and of the
 * renderer, so it is cached by content hash and never invalidated by an event
 * (ADR-031).
 */
export interface RenderedContent {
  readonly version: number
  readonly html: string
  readonly outline: readonly OutlineEntry[]
  readonly text: ExtractedText
  readonly links: readonly ExtractedLink[]
  /**
   * Live-block slot keys the body carries (ADR-032). The registry and its
   * block types arrive in M5; until one is registered a document has none.
   */
  readonly slots: readonly string[]
  readonly incompleteRequiredSections: readonly string[]
}

/** Published Markdown read back for metadata, without rendering it. */
export interface PublishedDocumentView {
  readonly frontMatter: Record<string, unknown>
  readonly title: string | undefined
}

export interface DocumentFormat {
  /** A blank document, or a template instantiated against its answers (ADR-029). */
  create(input: CreateDocumentContentInput): NewDocumentContent
  /**
   * A draft as the Markdown a publish writes: authoring scaffolding removed,
   * the document id stamped into front matter, and the front matter checked.
   * Checking warns and never blocks — an invalid field is still a field.
   */
  prepareForPublish(input: PreparePublishInput): PublishableDocument
  /**
   * A draft with a new title written into the document itself.
   *
   * A document's title lives in its content — the front matter `title`, and
   * the first heading when that is what names it (ADR-005) — and
   * `documents.title` is an index of it, rebuildable from the content
   * (ADR-034). A rename that wrote only the index would be undone by the next
   * publish, which re-derives the title from what the draft says.
   */
  retitle(input: RetitleInput): DraftContent
  /** Published Markdown to the cached body, outline, text, links, and slots (ADR-031). */
  render(input: RenderInput): RenderedContent
  read(markdown: string): PublishedDocumentView
  /**
   * Published Markdown back to the content a draft holds, so restoring an
   * older revision gives the author that revision to carry on from rather
   * than leaving their draft on the content the restore undid (ADR-015).
   */
  toDraft(markdown: string): DraftContent
}
