import { DocumentProperties } from '@quill/editor'

import { useWriteDraftFrontMatter } from './draft-front-matter.ts'

export interface DocumentPropertiesPanelProps {
  readonly documentId: string
  /** The draft envelope's record, which is what a publish serialises. */
  readonly frontMatter: Readonly<Record<string, unknown>>
  /** The document's title, which its first heading decides. */
  readonly headingTitle: string
  readonly editable: boolean
  readonly className?: string | undefined
  /** Called after the draft has the new record, so the editor can follow. */
  onWritten(frontMatter: Record<string, unknown>): void
}

/**
 * The properties strip, wired to this application's draft.
 *
 * The strip itself is `@quill/editor`'s and knows nothing about requests or
 * caches; this is the one place that says where a document's front matter is
 * kept and what has to happen when it changes. Two things do: the draft
 * envelope takes the new record, and then the caller mirrors it onto the
 * document's own front matter block and queues the save.
 */
export function DocumentPropertiesPanel({
  documentId,
  frontMatter,
  headingTitle,
  editable,
  className,
  onWritten,
}: DocumentPropertiesPanelProps) {
  const write = useWriteDraftFrontMatter(documentId)

  return (
    <DocumentProperties
      frontMatter={frontMatter}
      headingTitle={headingTitle}
      editable={editable}
      className={className}
      onChange={(next) => {
        write(next)
        onWritten(next)
      }}
    />
  )
}
