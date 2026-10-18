import {
  DocumentProperties,
  applyFrontMatter,
  applyFrontMatterSource,
  redoEdit,
  undoEdit,
  type DocumentEditorHandle,
} from '@quill/editor'
import { documentFacts } from '@quill/domain'
import { writeFrontMatter } from '@quill/markdown'
import type { DocumentLinkTarget } from '@quill/editor'

// By its own path rather than through `lib/api`'s barrel: the directory is
// the editor's alone, and the reading route pays for whatever the barrel reaches.
import { usePeopleDirectory } from '../../../lib/api/people.ts'
import { useMe } from '../../../lib/api/auth.ts'
import { useDocument } from '../../../lib/api/documents.ts'
import type { DraftFrontMatter } from './draft-front-matter.ts'

export interface DocumentPropertiesPanelProps {
  readonly documentId: string
  /** The draft's front matter, following the document's block (`useDraftFrontMatter`). */
  readonly frontMatter: DraftFrontMatter
  /** The document's title, which its first heading decides. */
  readonly headingTitle: string
  readonly editable: boolean
  /** Why it cannot be edited right now, said beside the values. */
  readonly readOnlyReason?: string | undefined
  /** The organisation's labels, offered as tags (ADR-037). */
  readonly tagSuggestions?: readonly string[] | undefined
  /** The live editor, whose history every property change becomes a step of. */
  readonly editor: () => DocumentEditorHandle['editor']
  /** The link editor's document search, which also finds a deprecated page's replacement. */
  readonly searchDocuments?:
    | ((query: string, signal: AbortSignal) => Promise<readonly DocumentLinkTarget[]>)
    | undefined
  readonly className?: string | undefined
}

/**
 * The properties line, wired to this application's editor and draft.
 *
 * The line itself is `@quill/editor`'s and knows nothing about requests or
 * caches; this is the one place that says where a document's front matter
 * goes when it changes. It goes onto the document's own front matter block,
 * as a transaction — which is what makes it undoable with everything else —
 * and `useDraftFrontMatter` carries the record from there to the draft that
 * autosave sends.
 */
export function DocumentPropertiesPanel({
  documentId,
  frontMatter,
  headingTitle,
  editable,
  readOnlyReason,
  tagSuggestions,
  editor,
  searchDocuments,
  className,
}: DocumentPropertiesPanelProps) {
  const facts = documentFacts(frontMatter.record)
  // The verifier is named on the same terms as the owners, in the same lookup.
  const verifier = facts.lifecycle?.state === 'verified' ? facts.lifecycle.verifiedBy : undefined
  const people = usePeopleDirectory(
    documentId,
    verifier === undefined ? facts.owners : [...facts.owners, verifier],
    editable,
  )
  // A verification is stamped with whoever is signed in: the session's, never typed.
  const me = useMe().data
  // The replacement is stored as an id; its title is read the way any
  // document is, so one the editor may not open stays unnamed.
  const replacedBy =
    facts.lifecycle?.state === 'deprecated' ? facts.lifecycle.supersededBy : undefined
  const replacement = useDocument(replacedBy).data

  function run(command: typeof undoEdit): void {
    const live = editor()
    if (live === null) return
    command(live.state, live.view.dispatch)
  }

  return (
    <DocumentProperties
      frontMatter={frontMatter.record}
      // A document whose tree has no block yet is offered its record as YAML;
      // applying it gives the document its block.
      source={frontMatter.source ?? writeFrontMatter({ ...frontMatter.record }, undefined) ?? ''}
      headingTitle={headingTitle}
      editable={editable}
      readOnlyReason={readOnlyReason}
      people={people}
      tagSuggestions={tagSuggestions}
      currentPerson={me === undefined ? undefined : { value: me.email, name: me.displayName }}
      searchDocuments={searchDocuments}
      replacementTitle={replacement?.title}
      className={className}
      onChange={(next) => {
        run(applyFrontMatter(next))
      }}
      onSourceChange={(yaml) => {
        run(applyFrontMatterSource(yaml))
      }}
      onUndo={() => {
        run(undoEdit)
      }}
      onRedo={() => {
        run(redoEdit)
      }}
    />
  )
}
