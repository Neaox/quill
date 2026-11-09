import { Link } from '@tanstack/react-router'

import { Callout, LocalTime, textLinkClassName } from '@quill/ui'

import type { RemovedDocument } from './removed-document.ts'

/**
 * What a reader who could read a page sees once its file has left the
 * repository (ADR-061, ADR-046): that it was removed, when, and in which
 * commit. Shown inside the shell, so the sidebar is still there to go on with.
 */
export function RemovedDocumentNotice({ removed }: { readonly removed: RemovedDocument }) {
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-3 px-8 py-10">
      <Callout tone="info" title="This page was removed">
        <p>
          “{removed.title}” was removed from its repository
          {removed.removedAt === '' ? undefined : (
            <>
              {' '}
              on <LocalTime value={removed.removedAt} format="date" />
            </>
          )}
          {removed.revision === null ? undefined : (
            <>
              , in commit <code title={removed.revision}>{removed.revision.slice(0, 12)}</code>
            </>
          )}
          . It comes back with its address and comments if its file returns.
        </p>
      </Callout>
      <Link to="/" className={textLinkClassName()}>
        Go to your workspaces
      </Link>
    </div>
  )
}

/** The line above a page that a removed page's old address led to (ADR-046). */
export function ReplacedNote({ title }: { readonly title: string }) {
  return (
    <p role="status" className="px-4 pt-4 text-sm text-muted sm:px-8">
      Redirected from “{title}”, which was removed from its repository.
    </p>
  )
}
