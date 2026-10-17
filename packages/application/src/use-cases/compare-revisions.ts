import { userId } from '@quill/domain'
import type { DocumentId, RevisionId, UserId } from '@quill/domain'

import type { BlobStore } from '../ports/blob-store.ts'
import type { ContentStore } from '../ports/content-store.ts'
import type {
  CompareContext,
  ComparedContent,
  ComparedSource,
  DocumentFormat,
  DraftContent,
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
import type { DrawnRenderInput } from './render-document.ts'

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
  /** Draw each change on its own too, and say which can be put back in the draft. */
  readonly patches?: boolean | undefined
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

export interface Sides {
  readonly kind: 'sides'
  readonly document: DocumentRow
  readonly before: string
  readonly after: string
  /** The draft, when it is the newer side: what it holds and the version it is at. */
  readonly draft?: {
    readonly content: DraftContent
    readonly version: number
    /** Who wrote what in it, as the draft row holds it. */
    readonly authorship: unknown
  }
}

export async function compareRevisions(
  deps: CompareRevisionsDependencies,
  command: CompareRevisionsCommand,
): Promise<CompareRevisionsResult> {
  const sides = await readSides(deps, command)
  if (sides.kind !== 'sides') return sides
  return compareSides(deps, sides, command)
}

/** Two texts already read, compared: the part of `compareRevisions` after the reading. */
export async function compareSides(
  deps: CompareRevisionsDependencies,
  sides: Sides,
  command: Pick<CompareRevisionsCommand, 'known' | 'patches'>,
): Promise<CompareRevisionsResult> {
  const [before, after] = await Promise.all([
    renderInputFor(deps, sides.document, sides.before),
    renderInputFor(deps, sides.document, sides.after),
  ])
  const patches = command.patches === true
  const key = comparisonKey(deps, before.input, after.input, sides.draft, patches)
  if (command.known === key) return { kind: 'not-modified', key }

  const content = deps.format.compare({
    before: sides.before,
    after: sides.after,
    context: bothSides(before.input, after.input),
    ...(patches ? { patches: true } : {}),
    ...(sides.draft === undefined
      ? {}
      : { draft: sides.draft.content, authorship: sides.draft.authorship }),
  })
  return { kind: 'compared', key, content: await withAuthorNames(deps, content) }
}

/** A user id from a ledger, which is a record and may hold what is not one: nothing then. */
function recordedUser(value: string): UserId[] {
  try {
    return [userId(value)]
  } catch {
    return []
  }
}

/** The changes' authors named: one lookup for all of them, however many changes there are. */
async function withAuthorNames(
  deps: Pick<CompareRevisionsDependencies, 'uow'>,
  content: ComparedContent,
): Promise<ComparedContent> {
  const ids = [...new Set(content.changes.flatMap(({ author }) => author?.userId ?? []))]
  if (ids.length === 0) return content
  const people = await deps.uow.repos.users.listByIds(ids.flatMap(recordedUser))
  const names = new Map<string, string>(people.map(({ id, displayName }) => [id, displayName]))
  return {
    ...content,
    changes: content.changes.map((change) =>
      change.author === undefined
        ? change
        : { ...change, author: { ...change.author, name: names.get(change.author.userId) } },
    ),
  }
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
export async function readSides(
  deps: Pick<CompareRevisionsDependencies, 'uow' | 'contentStore' | 'format'>,
  command: Pick<CompareRevisionsCommand, 'documentId' | 'from' | 'to' | 'appOrigins'>,
): Promise<Sides | Failure> {
  const document = await deps.uow.repos.documents.findById(command.documentId)
  if (document === null) return { kind: 'not-found', documentId: command.documentId }

  const published = async (revision: RevisionId): Promise<Side | Failure> => {
    const source = await readSource(deps, document.workspaceId, {
      documentId: document.id,
      revision,
    })
    return source === null
      ? { kind: 'revision-not-found', revision }
      : { kind: 'side', markdown: source.markdown }
  }
  const [before, after] = await Promise.all([
    command.from === null ? { kind: 'side' as const, markdown: '' } : published(command.from),
    command.to === DRAFT ? draftSide(deps, document, command.appOrigins) : published(command.to),
  ])
  if (before.kind !== 'side') return before
  if (after.kind !== 'side') return after
  return {
    kind: 'sides',
    document,
    before: before.markdown,
    after: after.markdown,
    ...(after.draft === undefined ? {} : { draft: after.draft }),
  }
}

interface Side {
  readonly kind: 'side'
  readonly markdown: string
  readonly draft?: Sides['draft']
}

/**
 * The draft as its next publish would write it: scaffolding removed, links in
 * their canonical form. Compared as anything else would be, so a link pasted
 * in its readable form is not a change the publish would not make.
 */
async function draftSide(
  deps: Pick<CompareRevisionsDependencies, 'uow' | 'format'>,
  document: DocumentRow,
  appOrigins: readonly string[] | undefined,
): Promise<Side | Failure> {
  const draft = await deps.uow.repos.drafts.find(document.id)
  const content = draft === null ? null : readDraftContent(draft.ast)
  if (draft === null || content === null) return { kind: 'no-draft', documentId: document.id }
  const prepared = deps.format.prepareForPublish({ documentId: document.id, content })
  return {
    kind: 'side',
    markdown: await canonicaliseLinks(deps.uow.repos.documents, prepared.markdown, appOrigins),
    draft: { content, version: draft.draftVersion, authorship: draft.authorship },
  }
}

/** What both sides are drawn with: every title either links to, every drawing either shows. */
function bothSides(before: DrawnRenderInput, after: DrawnRenderInput): CompareContext {
  return {
    linkTitles: new Map([...before.linkTitles, ...after.linkTitles]),
    drawings: new Map([...before.drawings, ...after.drawings]),
    labels: after.labels,
    emoji: after.emoji,
    labelEmoji: after.labelEmoji,
  }
}

/**
 * A comparison drawn change by change is a different answer from one that is not, and one
 * that says which changes can be put back in the draft depends on the draft as well as on
 * what it would publish, so its key carries both.
 */
function comparisonKey(
  deps: Pick<CompareRevisionsDependencies, 'hasher' | 'format'>,
  before: RenderInput,
  after: RenderInput,
  draft: Sides['draft'],
  patches: boolean,
): string {
  const digest = `${renderDigest(before, deps.format.extensions)}\u0003${renderDigest(after, deps.format.extensions)}`
  const detail = `${patches ? ':patches' : ''}${draft === undefined ? '' : `:draft-${String(draft.version)}`}`
  return `${deps.hasher.contentHash(digest)}:${RENDER_VERSION}:compare-${COMPARED_CONTENT_VERSION}${detail}`
}
