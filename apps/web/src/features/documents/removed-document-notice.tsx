import { Link } from '@tanstack/react-router'

import { Block, Callout, LayoutGrid, LocalTime, textLinkClassName } from '@quill/ui'

import { ShellAside } from '../workspaces/shell-slots.tsx'
import type { RemovedDocument } from './removed-document.ts'

/**
 * What a reader who could read a page sees once its file has left the
 * repository (ADR-061, ADR-046): that it was removed, in the reading column a
 * document's body uses, and when and in which commit beside it, where a
 * document's revisions are, with the way to
 * the workspace's own home, so the reader stays where they were. A page the
 * manifest redirects to a page the reader may open never shows this: the
 * route goes straight there, with a line saying where the reader came from.
 */
export function RemovedDocumentNotice({
  removed,
  workspace,
}: {
  readonly removed: RemovedDocument
  /** The workspace the page was in, for the way back to its home. */
  readonly workspace: { readonly slug: string; readonly name: string } | undefined
}) {
  return (
    <>
      <LayoutGrid className="pt-8 pb-24">
        <Block>
          <h1 className="text-3xl leading-tight font-semibold tracking-tight text-foreground">
            {removed.title}
          </h1>
        </Block>
        <Block className="mt-6">
          <Callout tone="info" title="This page was removed">
            <p>
              Its file was removed from the repository this workspace reads. The page comes back,
              with its address and comments, if the file returns.
            </p>
            {workspace === undefined ? undefined : (
              <p>
                <Link
                  to="/w/$workspaceSlug"
                  params={{ workspaceSlug: workspace.slug }}
                  className={textLinkClassName()}
                >
                  Go to {workspace.name}
                </Link>
              </p>
            )}
          </Callout>
        </Block>
      </LayoutGrid>
      {/*
        When and where, in the column a document's revisions use, so the
        notice sits in the reading column a document's body does.
      */}
      <ShellAside>
        <dl className="flex flex-col gap-1 text-sm">
          <dt className="section-label pb-1.5">Removed</dt>
          {removed.removedAt === '' ? undefined : (
            <dd className="text-foreground">
              <LocalTime value={removed.removedAt} format="date" />
            </dd>
          )}
          {removed.revision === null ? undefined : (
            <dd className="text-muted">
              in commit{' '}
              <code title={removed.revision} className="text-foreground">
                {removed.revision.slice(0, 12)}
              </code>
            </dd>
          )}
        </dl>
      </ShellAside>
    </>
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
