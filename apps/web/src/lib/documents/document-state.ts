import type { DocumentState } from '@quill/ui'

import type { DocumentDto } from '../api/index.ts'

const STATED: Readonly<Record<DocumentDto['status'], DocumentState>> = {
  draft: 'draft',
  published: 'published',
  archived: 'archived',
}

/**
 * The state a document's header shows.
 *
 * The stated status is what the document says about itself, and "published"
 * is only true once there is a published revision to read: a document whose
 * status says published but that has never been published is a draft, which
 * is what the page under the header says too ("Nothing published yet").
 * A published document whose draft holds changes nobody has published
 * (the envelope's `unpublishedChanges`, told only to someone who may edit)
 * is published with changes: the third answer (ADR-005 amendment).
 */
export function documentState(
  document: Pick<DocumentDto, 'status' | 'headRevision'>,
  unpublishedChanges = false,
): DocumentState {
  if (document.status === 'published' && document.headRevision === null) return 'draft'
  if (document.status === 'published' && unpublishedChanges) return 'changed'
  return STATED[document.status]
}
