import type { DocumentId, RevisionId } from '@quill/domain'

import type { BlobStore } from '../ports/blob-store.ts'
import type { ContentStore } from '../ports/content-store.ts'
import type {
  CompareContext,
  ComparedContent,
  ComparedSource,
  DocumentFormat,
  RenderInput,
} from '../ports/document-format.ts'
import { COMPARED_CONTENT_VERSION } from '../ports/document-format.ts'
import type { DocumentRow, UnitOfWork } from '../ports/persistence.ts'
import type { Settings } from '../ports/settings.ts'
import type { Hasher } from '../ports/system.ts'
import { canonicaliseLinks } from './canonical-links.ts'
import { readDraftContent } from './publish-document.ts'
import { readSource } from './read-published.ts'
import { RENDER_VERSION, renderDigest, renderInputFor } from './render-document.ts'

/**
 * Comparing two versions of one document (ADR-015): two published revisions,
 * or the published head and the draft being written — "what has changed since
 * it was published".
 *
 * The comparison is the document's own: the format compares the two texts and
 * draws them as one page, words, rows, items and lines marked, with nothing
 * about where either is stored in the answer. Both sides are read the way a
 * reader's page reads them, with the same link titles, drawings, labels and
 * emoji, so a comparison looks like the document it compares.
 *
 * A comparison is a pure function of its inputs, so its key is a digest of
 * both render inputs: a caller that already holds that key is told so before
 * anything is compared.
 */

export interface CompareRevisionsDependencies {
  readonly uow: UnitOfWork
  readonly contentStore: ContentStore
  readonly format: DocumentFormat
  readonly hasher: Hasher
  readonly blobStore: BlobStore
  readonly settings: Settings
}

/** The draft, as one side of a comparison: the document as its next publish would write it. */
export const DRAFT = 'draft'

export interface CompareRevisionsCommand {
  readonly documentId: DocumentId
  /** Null compares against nothing, which is how a document's first revision reads. */
  readonly from: RevisionId | null
  readonly to: RevisionId | typeof DRAFT
  /** The key of a comparison the caller already holds. */
  readonly known?: string | undefined
  /**
   * The origins this application is served at. A link pasted with one of
   * them is this application's own address, stored relative (ADR-035).
   */
  readonly appOrigins?: readonly string[] | undefined
}

type Failure =
  | { readonly kind: 'not-found'; readonly documentId: DocumentId }
  | { readonly kind: 'revision-not-found'; readonly revision: RevisionId }
  | { readonly kind: 'no-draft'; readonly documentId: DocumentId }

export type CompareRevisionsResult =
  | { readonly kind: 'compared'; readonly key: string; readonly content: ComparedContent }
  | { readonly kind: 'not-modified'; readonly key: string }
  | Failure

export type CompareSourcesResult =
  | { readonly kind: 'compared'; readonly source: ComparedSource }
  | Failure

interface Sides {
  readonly kind: 'sides'
  readonly document: DocumentRow
  readonly before: string
  readonly after: string
}

export async function compareRevisions(
  deps: CompareRevisionsDependencies,
  command: CompareRevisionsCommand,
): Promise<CompareRevisionsResult> {
  const sides = await readSides(deps, command)
  if (sides.kind !== 'sides') return sides

  const [before, after] = await Promise.all([
    renderInputFor(deps, sides.document, sides.before),
    renderInputFor(deps, sides.document, sides.after),
  ])
  const key = comparisonKey(deps, before.input, after.input)
  if (command.known === key) return { kind: 'not-modified', key }

  const content = deps.format.compare({
    before: sides.before,
    after: sides.after,
    context: bothSides(before.input, after.input),
  })
  return { kind: 'compared', key, content }
}

export async function compareRevisionSources(
  deps: Pick<CompareRevisionsDependencies, 'uow' | 'contentStore' | 'format'>,
  command: Omit<CompareRevisionsCommand, 'known'>,
): Promise<CompareSourcesResult> {
  const sides = await readSides(deps, command)
  if (sides.kind !== 'sides') return sides
  return { kind: 'compared', source: deps.format.compareSource(sides.before, sides.after) }
}

/**
 * Both texts, each checked against this document's own history before the
 * content store is asked for it (ADR-014: the index is the record), and read
 * together: one waiting for the other is a round trip nobody needs.
 */
async function readSides(
  deps: Pick<CompareRevisionsDependencies, 'uow' | 'contentStore' | 'format'>,
  command: Omit<CompareRevisionsCommand, 'known'>,
): Promise<Sides | Failure> {
  const document = await deps.uow.repos.documents.findById(command.documentId)
  if (document === null) return { kind: 'not-found', documentId: command.documentId }

  const published = async (revision: RevisionId): Promise<string | Failure> => {
    const source = await readSource(deps, document.workspaceId, {
      documentId: document.id,
      revision,
    })
    return source === null ? { kind: 'revision-not-found', revision } : source.markdown
  }
  const [before, after] = await Promise.all([
    command.from === null ? '' : published(command.from),
    command.to === DRAFT
      ? draftMarkdown(deps, document, command.appOrigins)
      : published(command.to),
  ])
  if (typeof before !== 'string') return before
  if (typeof after !== 'string') return after
  return { kind: 'sides', document, before, after }
}

/**
 * The draft as its next publish would write it: scaffolding removed, links in
 * their canonical form. Compared as anything else would be, so a link pasted
 * in its readable form is not a change the publish would not make.
 */
async function draftMarkdown(
  deps: Pick<CompareRevisionsDependencies, 'uow' | 'format'>,
  document: DocumentRow,
  appOrigins: readonly string[] | undefined,
): Promise<string | Failure> {
  const draft = await deps.uow.repos.drafts.find(document.id)
  const content = draft === null ? null : readDraftContent(draft.ast)
  if (content === null) return { kind: 'no-draft', documentId: document.id }
  const prepared = deps.format.prepareForPublish({ documentId: document.id, content })
  return canonicaliseLinks(deps.uow.repos.documents, prepared.markdown, appOrigins)
}

/** What both sides are drawn with: every title either links to, every drawing either shows. */
function bothSides(before: RenderInput, after: RenderInput): CompareContext {
  return {
    linkTitles: new Map([...before.linkTitles, ...after.linkTitles]),
    drawings: new Map([...(before.drawings ?? []), ...(after.drawings ?? [])]),
    labels: after.labels,
    emoji: after.emoji,
    labelEmoji: after.labelEmoji,
  }
}

function comparisonKey(
  deps: Pick<CompareRevisionsDependencies, 'hasher' | 'format'>,
  before: RenderInput,
  after: RenderInput,
): string {
  const digest = `${renderDigest(before, deps.format.extensions)}\u0003${renderDigest(after, deps.format.extensions)}`
  return `${deps.hasher.contentHash(digest)}:${RENDER_VERSION}:compare-${COMPARED_CONTENT_VERSION}`
}
