import type { ReactNode } from 'react'

import { BRAND } from '@quill/brand'
import { Badge, Callout, CollectionIcon, DocumentIcon, tv } from '@quill/ui'

import type { SourcePreviewDto } from '../../lib/api/index.ts'
import { SKIP_REASONS } from './source-form-model.ts'
import { shortRevision } from './source-words.ts'

/**
 * What saving a source's settings would do, as the server's dry run answered
 * it (ADR-061): which collections there will be, which pages land in each as
 * the tree a reader will see, what is left out and why, and — for a
 * workspace already reading a repository — what moves, arrives or leaves.
 *
 * Everything essential is on the page, in words: a badge says what an icon
 * or a colour would, and nothing waits behind a tooltip. Long lists fold
 * into a disclosure whose summary already says how many there are.
 */

type Collection = SourcePreviewDto['collections'][number]
type Node = Collection['nodes'][number]

/** Collections with more pages than this open folded, so the page stays short. */
const OPEN_UP_TO = 40

/** Reasons with this few files open with their paths shown; more fold to their count. */
const OPEN_SKIPPED_UP_TO = 5

const previewStyles = tv({
  slots: {
    tree: 'flex min-w-0 flex-col',
    // A level below the top: indented, with a rule down its side to say what it is under.
    branch: 'ms-4 flex min-w-0 flex-col border-s border-border ps-3',
    // On a phone the badges take a line of their own under the words, so a
    // path is never squeezed into a column a few letters wide.
    row: 'flex min-w-0 flex-wrap items-start gap-x-2 gap-y-1 border-b border-border py-1.5 last:border-b-0',
    icon: 'mt-0.5 size-3.5 shrink-0 text-muted',
    words: 'flex min-w-0 grow basis-0 flex-col',
    title: 'min-w-0 text-sm break-words text-foreground',
    path: 'min-w-0 font-mono text-2xs break-all text-muted',
    badges:
      'flex shrink-0 flex-wrap justify-end gap-1 max-sm:basis-full max-sm:justify-start max-sm:ps-5.5 empty:hidden',
    summary: [
      'focus-ring flex cursor-pointer list-none items-center gap-2 rounded-sm py-1 text-sm',
      'font-medium text-foreground marker:hidden [&::-webkit-details-marker]:hidden',
      'before:inline-block before:transition-transform before:content-["▸"] in-open:before:rotate-90',
    ],
  },
})

export function SourcePreviewPanel({
  preview,
  branch,
}: {
  readonly preview: SourcePreviewDto
  readonly branch: string
}) {
  const unknown = preview.manifest.unknownKeys
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <p className="text-sm text-muted">
        Read from <code>{branch}</code> at{' '}
        <code title={preview.revision}>{shortRevision(preview.revision)}</code>.{' '}
        {preview.origin === 'manifest' ? (
          <>
            The manifest, <code>{preview.manifest.path}</code>, decides the collections
            {preview.manifest.entry === null ? (
              ''
            ) : (
              <>
                {' '}
                (its <code>{preview.manifest.entry}</code> workspace)
              </>
            )}
            .
          </>
        ) : preview.origin === 'settings' ? (
          <>
            The repository has no <code>{preview.manifest.path}</code>, so the collections you name
            here decide what is read.
          </>
        ) : undefined}
      </p>

      {preview.changes === null ? undefined : <ChangeSummary changes={preview.changes} />}

      {preview.collections.length === 0 ? undefined : (
        <section aria-labelledby="preview-collections" className="flex min-w-0 flex-col gap-4">
          <h3 id="preview-collections" className="text-base font-semibold text-foreground">
            {preview.collections.length === 1
              ? 'One collection'
              : `${String(preview.collections.length)} collections`}
          </h3>
          {preview.collections.map((collection) => (
            <CollectionPreview key={collection.slug} collection={collection} />
          ))}
        </section>
      )}

      <LeftOut preview={preview} />

      {unknown.length === 0 ? undefined : (
        <Callout tone="info" title="Manifest keys this release doesn’t read">
          <p>They are kept, and change nothing here.</p>
          <ul className="flex flex-col gap-0.5">
            {unknown.map(({ key, line }) => (
              <li key={`${key}:${String(line)}`}>
                <code className="break-all">{key}</code>
                {line === null ? '' : `, line ${String(line)}`}
              </li>
            ))}
          </ul>
        </Callout>
      )}
    </div>
  )
}

function plural(count: number, one: string, many: string): string {
  return `${count === 1 ? 'one' : count.toLocaleString('en')} ${count === 1 ? one : many}`
}

/** What saving does to a workspace that already reads a repository, in one sentence and a list. */
function ChangeSummary({
  changes,
}: {
  readonly changes: NonNullable<SourcePreviewDto['changes']>
}) {
  const { added, moved, unchanged, archived, retired } = changes
  const parts = [
    added > 0 ? `adds ${plural(added, 'page', 'pages')}` : null,
    moved > 0 ? `moves ${plural(moved, 'page', 'pages')} to another collection` : null,
    archived.length > 0 ? `archives ${plural(archived.length, 'page', 'pages')}` : null,
    retired.length > 0 ? `retires ${plural(retired.length, 'collection', 'collections')}` : null,
  ].filter((part) => part !== null)
  const sentence =
    parts.length === 0
      ? 'Saving changes no page.'
      : `Saving ${parts.length === 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1) ?? ''}`}.`
  return (
    <Callout
      tone={archived.length > 0 || retired.length > 0 ? 'warning' : 'info'}
      title="What saving does"
    >
      <p>
        {sentence}{' '}
        {unchanged > 0
          ? `${capitalise(plural(unchanged, 'page stays', 'pages stay'))} as ${unchanged === 1 ? 'it is' : 'they are'}.`
          : ''}
      </p>
      {archived.length === 0 ? undefined : (
        <Fold summary={`Archived: ${plural(archived.length, 'page', 'pages')}`}>
          <p className="text-xs text-muted">
            An archived page answers that it was removed, and comes back with its address and
            comments if its file returns.
          </p>
          <ul className="flex flex-col">
            {archived.map(({ path, title }) => (
              <li key={path} className="flex min-w-0 flex-col py-1">
                <span className="text-sm text-foreground">{title}</span>
                <code className="text-2xs break-all text-muted">{path}</code>
              </li>
            ))}
          </ul>
        </Fold>
      )}
      {retired.length === 0 ? undefined : (
        <p>
          Retired:{' '}
          {retired.map(({ slug, title }, index) => (
            <span key={slug}>
              {index === 0 ? '' : ', '}
              {title}
            </span>
          ))}
          . The manifest no longer names {retired.length === 1 ? 'it' : 'them'}.
        </p>
      )}
    </Callout>
  )
}

function capitalise(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`
}

const ORDER: Readonly<Record<string, string>> = {
  title: 'by title',
  filename: 'by file name',
  newest: 'newest first',
  oldest: 'oldest first',
}

function CollectionPreview({ collection }: { readonly collection: Collection }) {
  const id = `preview-collection-${collection.slug}`
  return (
    <section
      aria-labelledby={id}
      className="flex min-w-0 flex-col gap-2 rounded-md border border-border p-3"
    >
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
        <h4 id={id} className="text-sm font-semibold text-foreground">
          {collection.title}
        </h4>
        {collection.status === 'new' ? <Badge tone="accent">New collection</Badge> : undefined}
        {collection.status === 'renamed' ? (
          <Badge tone="warning">Renamed from {collection.previousTitle}</Badge>
        ) : undefined}
      </div>
      <p className="text-xs text-muted">
        From <code className="break-all">{collection.path}</code>,{' '}
        {plural(collection.documents, 'page', 'pages')}, ordered{' '}
        {ORDER[collection.order] ?? collection.order}.
      </p>
      {collection.nodes.length === 0 ? (
        <p className="text-sm text-muted">Nothing under this path is a page yet.</p>
      ) : (
        <Fold summary={`Pages in ${collection.title}`} open={collection.nodes.length <= OPEN_UP_TO}>
          <Tree nodes={collection.nodes} label={`Pages in ${collection.title}`} />
        </Fold>
      )}
    </section>
  )
}

interface Nested {
  readonly node: Node
  readonly children: Nested[]
}

/** The flat, ordered nodes nested back into lists, so the tree is a real nested list. */
function nest(nodes: readonly Node[]): readonly Nested[] {
  const roots: Nested[] = []
  const stack: Nested[] = []
  for (const node of nodes) {
    const entry: Nested = { node, children: [] }
    while (stack.length > node.depth) stack.pop()
    const parent = stack.at(-1)
    if (parent === undefined) roots.push(entry)
    else parent.children.push(entry)
    stack.push(entry)
  }
  return roots
}

function Tree({ nodes, label }: { readonly nodes: readonly Node[]; readonly label: string }) {
  const styles = previewStyles()
  return <Branch entries={nest(nodes)} label={label} className={styles.tree()} />
}

function Branch({
  entries,
  label,
  className,
}: {
  readonly entries: readonly Nested[]
  readonly label?: string
  readonly className: string
}) {
  const styles = previewStyles()
  return (
    <ul aria-label={label} className={className}>
      {entries.map(({ node, children }) => (
        <li key={`${node.kind}:${node.path}`} className="min-w-0">
          <div className={styles.row()}>
            {node.kind === 'document' ? (
              <DocumentIcon className={styles.icon()} />
            ) : (
              <CollectionIcon className={styles.icon()} />
            )}
            <span className={styles.words()}>
              <span className={styles.title()}>{node.title}</span>
              <span className={styles.path()}>{node.path}</span>
            </span>
            <span className={styles.badges()}>
              {node.kind === 'folder' ? <Badge>Folder page</Badge> : undefined}
              {node.kind === 'generated-folder' ? (
                <Badge>Folder page, written by {BRAND.name}</Badge>
              ) : undefined}
              {node.change === 'added' ? <Badge tone="success">Added</Badge> : undefined}
              {node.change === 'moved' ? <Badge tone="warning">Moved here</Badge> : undefined}
            </span>
          </div>
          {children.length === 0 ? undefined : (
            <Branch entries={children} className={styles.branch()} />
          )}
        </li>
      ))}
    </ul>
  )
}

/** A disclosure whose summary says what is inside and how much; keyboard-operable as is. */
function Fold({
  summary,
  open = false,
  children,
}: {
  readonly summary: string
  readonly open?: boolean
  readonly children: ReactNode
}) {
  const styles = previewStyles()
  return (
    <details open={open} className="group min-w-0">
      <summary className={styles.summary()}>{summary}</summary>
      <div className="mt-1 flex min-w-0 flex-col gap-2">{children}</div>
    </details>
  )
}

/** What is not a page, by why, and what the preview did not get to. */
function LeftOut({ preview }: { readonly preview: SourcePreviewDto }) {
  const { skipped, assets, limits } = preview
  return (
    <>
      {limits.truncated ? (
        <Callout tone="warning" title="The preview stopped early">
          There are more than {limits.files.toLocaleString('en')} files under these paths, so the
          preview shows the first {limits.files.toLocaleString('en')}. The sync reads them all.
        </Callout>
      ) : undefined}
      {skipped.length > 0 ? (
        <LeftOutList skipped={skipped} />
      ) : preview.collections.length > 0 ? (
        <p className="text-sm text-muted">Every Markdown file under these paths becomes a page.</p>
      ) : undefined}
      {assets > 0 ? (
        <p className="text-sm text-muted">
          Images and other files a page shows are imported with that page:{' '}
          {assets.toLocaleString('en')} here.
        </p>
      ) : undefined}
      {limits.unread > 0 ? (
        <p className="text-sm text-muted">
          {capitalise(plural(limits.unread, 'page wasn’t', 'pages weren’t'))} read for the preview,
          so {limits.unread === 1 ? 'its title comes' : 'their titles come'} from the file name and{' '}
          {limits.unread === 1 ? 'it wasn’t' : 'they weren’t'} checked for size or encoding.
        </p>
      ) : undefined}
    </>
  )
}

/** The files that won't become pages, by why, each reason folded to its count when long. */
function LeftOutList({ skipped }: { readonly skipped: SourcePreviewDto['skipped'] }) {
  return (
    <section aria-labelledby="preview-left-out" className="flex min-w-0 flex-col gap-3">
      <div>
        <h3 id="preview-left-out" className="text-base font-semibold text-foreground">
          Left out
        </h3>
        <p className="mt-0.5 text-sm text-muted">
          These files under the collections’ paths won’t become pages.
        </p>
      </div>
      {skipped.map(({ reason, count, paths, patterns }) => {
        const words = SKIP_REASONS[reason] ?? { title: 'Left out', detail: '' }
        return (
          <Fold
            key={reason}
            summary={`${words.title}: ${count.toLocaleString('en')}`}
            open={count <= OPEN_SKIPPED_UP_TO}
          >
            <p className="text-xs text-muted">{words.detail}</p>
            <ul aria-label={words.title} className="flex flex-col">
              {paths.map((path) => (
                <li key={path} className="flex min-w-0 flex-col py-1">
                  <code className="text-xs break-all text-foreground">{path}</code>
                  {patterns[path] === undefined ? undefined : (
                    <span className="text-2xs text-muted">
                      Matches <code>{patterns[path]}</code>
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {count > paths.length ? (
              <p className="text-xs text-muted">
                And {(count - paths.length).toLocaleString('en')} more.
              </p>
            ) : undefined}
          </Fold>
        )
      })}
    </section>
  )
}
