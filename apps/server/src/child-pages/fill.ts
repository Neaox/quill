import { listChildPages } from '@quill/application'
import type {
  ChildPagesAudience,
  ChildPagesDependencies,
  DocumentRow,
  WorkspaceRow,
} from '@quill/application'
import { childPagesQueries, childPagesSlotKey, fillChildPagesSlots } from '@quill/markdown'
import type { ChildPage } from '@quill/markdown'

import { toChildPages } from './present.ts'

export interface FillChildPagesInput {
  /** The cached body (ADR-031), with its slots. */
  readonly html: string
  readonly parent: DocumentRow
  readonly workspace: WorkspaceRow
  readonly audience: ChildPagesAudience
  /** Where this surface reads a page. */
  readonly hrefOf: (document: DocumentRow) => string
}

/**
 * A body with its child pages slots filled, for a page assembled on the
 * server (ADR-032, ADR-049): the public site, and the signed-in reader's
 * preview of it. Each distinct query is asked once, and a body with no slot
 * costs nothing at all. A tree that cannot be resolved leaves the slots as
 * their fallback rather than failing the page: the page is the point.
 */
export async function fillChildPages(
  deps: ChildPagesDependencies,
  input: FillChildPagesInput,
): Promise<string> {
  const queries = childPagesQueries(input.html)
  if (queries.length === 0) return input.html
  const listed = await Promise.all(
    queries.map((query) =>
      listChildPages(deps, {
        parent: input.parent,
        workspace: input.workspace,
        options: { depth: query.depth, sort: query.sort },
        audience: input.audience,
      }),
    ),
  )
  const answers = new Map<string, readonly ChildPage[]>()
  for (const [index, query] of queries.entries()) {
    const answer = listed[index]
    /* v8 ignore next -- the page was just placed in this very tree. */
    if (answer?.kind !== 'pages') return input.html
    answers.set(childPagesSlotKey(query), toChildPages(answer.pages, input.hrefOf))
  }
  /* v8 ignore next -- every query was answered above. */
  return fillChildPagesSlots(input.html, (query) => answers.get(childPagesSlotKey(query)) ?? [])
}
