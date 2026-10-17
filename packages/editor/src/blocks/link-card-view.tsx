import { fileKindOf, fileMeta, linkDirective } from '@quill/markdown'
import { DocumentIcon, FileIcon, LinkIcon } from '@quill/ui'
import { NodeViewContent, NodeViewWrapper } from '@tiptap/react'
import { useEffect } from 'react'
import type { NodeViewProps } from '@tiptap/react'
import { tv } from 'tailwind-variants'

import { directiveAttributes } from '../schema/directive-attributes.ts'
import { useLinkPreviewSource } from './link-preview-context.tsx'
import type { EditorLinkPreview } from './link-preview-context.tsx'

/**
 * A link card as it is written (ADR-042): the same card the reader will see, drawn
 * from the preview when the application has one and from the address while it has
 * not, so the block holds its place and the author is never shown an error.
 *
 * The author's own words and the title and description they chose win over the
 * page's, exactly as they do for the reader. The card is a block to select, not a
 * link to follow: pressing it selects it, which is what brings up the toolbar to
 * change how it is shown.
 */

const card = tv({
  slots: {
    root: [
      'link-card-editor flex items-stretch overflow-hidden rounded-md border border-border',
      'bg-surface-raised text-sm leading-snug',
      'data-[selected=true]:border-accent data-[selected=true]:ring-2 data-[selected=true]:ring-focus-ring',
    ],
    body: 'flex min-w-0 flex-1 flex-col justify-center gap-1 px-4 py-3',
    title: 'line-clamp-2 font-medium text-foreground [overflow-wrap:anywhere]',
    description: 'line-clamp-2 text-body [overflow-wrap:anywhere]',
    site: 'flex items-center gap-1.5 truncate text-xs text-muted',
    icon: 'size-4 shrink-0 rounded-sm object-contain',
    picture: 'w-36 shrink-0 self-stretch border-s border-border object-cover',
    pending: 'h-3 w-2/3 rounded-sm bg-border motion-safe:animate-pulse',
    compact: [
      'link-compact-editor flex items-center rounded-md border border-border bg-surface-raised px-3 py-1.5 text-sm',
      'data-[selected=true]:border-accent data-[selected=true]:ring-2 data-[selected=true]:ring-focus-ring',
    ],
  },
  variants: {
    layout: {
      side: {},
      top: {
        root: 'max-w-md flex-col-reverse',
        picture: 'aspect-[1.91/1] w-full border-s-0 border-b',
      },
    },
  },
})

function hostOf(address: string): string {
  // A document of this instance is named by its id; until its title arrives, say what it is.
  if (address.startsWith('/d/')) return 'Document'
  try {
    return new URL(address).host
  } catch {
    return address
  }
}

/** The small icon in front of a card's site line or a compact line: a document's, a file's, or a link's. */
function LeadingIcon({ preview }: { readonly preview: EditorLinkPreview | null }) {
  const kind = preview?.file === undefined ? null : fileKindOf(preview.file.mediaType)
  if (kind !== null) return <FileIcon kind={kind} className="size-3.5" />
  if (preview?.layer === 'internal') return <DocumentIcon className="size-3.5 shrink-0" />
  return <LinkIcon className="size-3.5" />
}

export function LinkCardBlock({ node, selected }: NodeViewProps) {
  const link = linkDirective.parse({
    type: 'leafDirective',
    name: 'link',
    attributes: directiveAttributes(node),
    children: [{ type: 'text', value: node.textContent }],
  })
  const source = useLinkPreviewSource()
  const { request, imageUrl } = source
  const preview = source.preview(link.url)
  const address = link.url

  // Tells the application which page this card is showing: it is the application that fetches.
  useEffect(() => {
    request(address)
  }, [request, address])
  const styles = card({ layout: link.choice.layout })
  const host = hostOf(link.url)

  const title = link.choice.title ?? link.text ?? preview?.title ?? link.url
  const file = preview?.file
  // A file has no description of its own: it says what it is and how big, as the reader's card does.
  const description =
    link.choice.description ?? preview?.description ?? (file === undefined ? null : fileMeta(file))
  const picture = link.choice.showImage ? (preview?.thumbnail ?? null) : null
  const fileKind = file === undefined ? null : fileKindOf(file.mediaType)

  if (link.choice.display === 'compact') {
    return (
      <NodeViewWrapper
        className={styles.compact()}
        data-directive="link"
        data-selected={selected}
        role="group"
        aria-label={`Compact link: ${title}`}
      >
        <NodeViewContent className="hidden" />
        <span className="flex min-w-0 items-center gap-2" contentEditable={false}>
          {preview?.favicon == null ? (
            <LeadingIcon preview={preview} />
          ) : (
            <img
              className={styles.icon()}
              src={imageUrl(preview.favicon)}
              alt=""
              width={preview.favicon.width}
              height={preview.favicon.height}
            />
          )}
          <span className="truncate font-medium text-foreground">{title}</span>
          <span className="truncate text-xs text-muted">{preview?.siteName ?? host}</span>
        </span>
      </NodeViewWrapper>
    )
  }

  return (
    <NodeViewWrapper
      className={styles.root()}
      data-directive="link"
      data-selected={selected}
      role="group"
      aria-label={`Link card: ${title}`}
    >
      {/* The author's own words live here, and are shown as the title above. Without this the
          editor makes a content line of its own, which would be an empty line above the card. */}
      <NodeViewContent className="hidden" />
      {fileKind === null || picture !== null ? null : (
        <span className="flex items-center ps-4 text-muted" contentEditable={false}>
          <FileIcon kind={fileKind} className="size-9" />
        </span>
      )}
      <div className={styles.body()} contentEditable={false}>
        <p className={styles.title()}>{title}</p>
        {description === null || description === '' ? null : (
          <p className={styles.description()}>{description}</p>
        )}
        {preview === null && link.choice.description === null ? (
          <span aria-hidden="true" className={styles.pending()} />
        ) : null}
        <p className={styles.site()}>
          {preview?.favicon == null ? (
            <LeadingIcon preview={preview} />
          ) : (
            <img
              className={styles.icon()}
              src={imageUrl(preview.favicon)}
              alt=""
              width={preview.favicon.width}
              height={preview.favicon.height}
            />
          )}
          <span className="truncate">{preview?.siteName ?? host}</span>
        </p>
      </div>
      {picture === null ? null : (
        <img
          className={styles.picture()}
          src={imageUrl(picture)}
          alt=""
          width={picture.width}
          height={picture.height}
          contentEditable={false}
          draggable={false}
        />
      )}
    </NodeViewWrapper>
  )
}
