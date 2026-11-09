import { readSourceRemoval } from '@quill/application'
import type { Authorizer, DocumentRow } from '@quill/application'

import type { AppDependencies } from '../dependencies.ts'
import { AppError } from '../errors.ts'

/**
 * A page whose file left its repository answers 410, as ADR-046 has a
 * deleted page answer (ADR-061). It is asked only after the reader passed the
 * `view` check, so a person the page was hidden from is refused exactly as
 * before and learns nothing of it.
 *
 * The answer names the page, when and in which commit it was removed, and
 * the page the manifest's `redirects` send its old path to, when the reader
 * may open that one too: the app follows it, saying where the reader came
 * from. A replacement the reader may not open is not named.
 */
export async function refuseRemovedSourceDocument(
  deps: Pick<AppDependencies, 'uow'>,
  authorizer: Authorizer,
  document: DocumentRow,
): Promise<void> {
  const removal = await readSourceRemoval(deps, document)
  if (removal === null) return
  const replacement =
    removal.replacement === null ? null : await authorizer.document(removal.replacement)
  const readable =
    replacement?.ok === true && replacement.value.capabilities.view
      ? replacement.value.document
      : null
  throw new AppError(410, 'document_removed', 'This page was removed from its repository', {
    title: removal.title,
    removedAt: removal.removedAt.toISOString(),
    revision: removal.revision,
    replacement:
      readable === null
        ? null
        : { id: readable.id, shortId: readable.shortId, title: readable.title },
  })
}
