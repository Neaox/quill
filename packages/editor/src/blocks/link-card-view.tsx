import { linkDirective, nearestEmbedRatio } from '@quill/markdown'
import type { EmbedRatioName } from '@quill/markdown'
import { Badge, LinkIcon } from '@quill/ui'
import { NodeViewContent, NodeViewWrapper } from '@tiptap/react'
import { useEffect } from 'react'
import type { NodeViewProps } from '@tiptap/react'
import { tv } from 'tailwind-variants'

import { directiveAttributes } from '../schema/directive-attributes.ts'
import { useLinkPreviewSource } from './link-preview-context.tsx'
import type { EditorLinkStatus } from './link-preview-context.tsx'

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
    embed: [
      'link-embed-editor flex w-full max-w-xl flex-col items-center justify-center gap-1 rounded-md border border-dashed',
      'border-border-strong bg-surface-raised p-4 text-center text-sm',
      'data-[selected=true]:border-accent data-[selected=true]:ring-2 data-[selected=true]:ring-focus-ring',
    ],
    code: [
      'max-h-[4.5em] overflow-hidden rounded-sm border border-border bg-code-background px-2 py-1',
      'font-mono text-2xs leading-snug text-foreground whitespace-pre',
    ],
    compact: [
      'link-compact-editor flex items-center rounded-md border border-border bg-surface-raised px-3 py-1.5 text-sm',
      'data-[selected=true]:border-accent data-[selected=true]:ring-2 data-[selected=true]:ring-focus-ring',
    ],
  },
  variants: {
    ratio: {
      '7:3': { embed: 'aspect-[7/3]' },
      '16:9': { embed: 'aspect-video' },
      '16:10': { embed: 'aspect-[16/10]' },
      '4:3': { embed: 'aspect-[4/3]' },
      '1:1': { embed: 'aspect-square' },
      '9:10': { embed: 'aspect-[9/10]' },
    } satisfies Record<EmbedRatioName, { embed: string }>,
    layout: {
      side: {},
      top: {
        root: 'max-w-md flex-col-reverse',
        picture: 'aspect-[1.91/1] w-full border-s-0 border-b',
      },
    },
  },
})

/** How many lines of a code permalink the card shows; the page it links to has the rest. */
const CODE_EXCERPT_LINES = 3

/** The state a connector reported, in words: the tone is emphasis, never the meaning. */
function LinkStatus({ status }: { readonly status: EditorLinkStatus | undefined }) {
  if (status === undefined) return null
  return (
    <span className="self-start" data-link-status contentEditable={false}>
      <Badge tone={status.tone}>{status.label}</Badge>
    </span>
  )
}

function hostOf(address: string): string {
  try {
    return new URL(address).host
  } catch {
    return address
  }
}

function ratioLabel(aspectRatio: number): string {
  return nearestEmbedRatio(aspectRatio)
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
  const embed = preview?.embed
  const styles = card({
    layout: link.choice.layout,
    ratio: embed === undefined ? '16:9' : nearestEmbedRatio(embed.aspectRatio),
  })
  const host = hostOf(link.url)

  const title = link.choice.title ?? link.text ?? preview?.title ?? link.url
  const description = link.choice.description ?? preview?.description ?? null
  const picture = link.choice.showImage ? (preview?.thumbnail ?? null) : null

  // The writing surface never loads the frame: an embed is a place held for it, which says what
  // will be there and how big. The reader and the published page draw the live frame.
  if (link.choice.display === 'embed' && embed !== undefined) {
    return (
      <NodeViewWrapper
        className={styles.embed()}
        data-directive="link"
        data-selected={selected}
        role="group"
        aria-label={`Embedded ${embed.provider}: ${title}`}
      >
        <NodeViewContent className="hidden" />
        <div className="flex min-w-0 flex-col items-center gap-1" contentEditable={false}>
          <LinkIcon className="size-5 text-muted" />
          <p className="font-medium text-foreground">{embed.provider} embed</p>
          <p className="max-w-full truncate text-muted">{title}</p>
          <p className="text-xs text-muted">
            Shown live to readers · {ratioLabel(embed.aspectRatio)}
          </p>
        </div>
      </NodeViewWrapper>
    )
  }

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
            <LinkIcon className="size-3.5 shrink-0" />
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
          <LinkStatus status={preview?.status} />
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
      <div className={styles.body()} contentEditable={false}>
        <p className={styles.title()}>{title}</p>
        <LinkStatus status={preview?.status} />
        {description === null || description === '' ? null : (
          <p className={styles.description()}>{description}</p>
        )}
        {preview?.code === undefined ? null : (
          // A glance at the lines, as text; the reader's page shows them in full.
          <>
            <p className="truncate font-mono text-2xs text-muted">{preview.code.repository}</p>
            <pre className={styles.code()} data-first-line={preview.code.startLine}>
              {preview.code.lines.slice(0, CODE_EXCERPT_LINES).join('\n')}
            </pre>
          </>
        )}
        {preview === null && link.choice.description === null ? (
          <span aria-hidden="true" className={styles.pending()} />
        ) : null}
        <p className={styles.site()}>
          {preview?.favicon == null ? (
            <LinkIcon className="size-3.5" />
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
