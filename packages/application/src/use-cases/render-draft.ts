import type { DocumentId, RevisionId } from '@quill/domain'

import type { RenderedContent } from '../ports/document-format.ts'
import { canonicaliseLinks } from './canonical-links.ts'
import { readDraftContent } from './publish-document.ts'
import { renderInputFor } from './render-document.ts'
import type { RenderDocumentDependencies } from './render-document.ts'

/**
 * A document's draft, drawn as a reader would see it if it were published now.
 *
 * It is the page of `renderDocument` for content nobody has published: the draft
 * is written as its next publish would write it (scaffolding removed, links in
 * their canonical form, as a comparison does), and drawn from the same inputs
 * as a published body, so a preview of a draft cannot drift from what the draft
 * becomes.
 *
 * It is a read that leaves everything as it found it. Nothing is cached, because
 * a draft changes as it is typed and its body would never be asked for twice; and
 * the link index is not touched, because it describes what is published.
 * Who may look is the caller's question, and the answer is whoever may edit: a
 * draft is not a reader's to see.
 */

export interface RenderDraftCommand {
  readonly documentId: DocumentId
}

export type RenderDraftResult =
  | {
      readonly kind: 'rendered'
      readonly content: RenderedContent
      /** The title the draft will publish under, which a heading may have changed. */
      readonly title: string
      /** When the draft was last saved, which is what the preview shows. */
      readonly savedAt: Date
      /** The revision the draft is based on. */
      readonly base: RevisionId | null
    }
  | { readonly kind: 'no-draft'; readonly documentId: DocumentId }
  | { readonly kind: 'not-found'; readonly documentId: DocumentId }

export async function renderDraft(
  deps: RenderDocumentDependencies,
  command: RenderDraftCommand,
): Promise<RenderDraftResult> {
  const { repos } = deps.uow
  const document = await repos.documents.findById(command.documentId)
  if (document === null) return { kind: 'not-found', documentId: command.documentId }

  const draft = await repos.drafts.find(command.documentId)
  const content = draft === null ? null : readDraftContent(draft.ast)
  if (draft === null || content === null) {
    return { kind: 'no-draft', documentId: command.documentId }
  }

  const prepared = deps.format.prepareForPublish({ documentId: document.id, content })
  const markdown = await canonicaliseLinks(repos.documents, prepared.markdown)
  const { input } = await renderInputFor(deps, document, markdown)
  return {
    kind: 'rendered',
    content: deps.format.render(input),
    title: prepared.title ?? document.title,
    savedAt: draft.updatedAt,
    base: draft.baseRevision,
  }
}
