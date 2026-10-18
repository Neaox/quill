import type { Ref } from 'react'

import { tv } from '../lib/class-names.ts'

export const linkPreviewPanelStyles = tv({
  slots: {
    panel: [
      'menu-panel flex w-80 max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-lg border',
      'border-border bg-surface-raised text-xs leading-relaxed text-body shadow-overlay',
    ],
    picture: 'h-28 w-full border-b border-border object-cover',
    body: 'flex flex-col gap-1 p-3',
    title: 'line-clamp-2 text-sm font-medium text-foreground [overflow-wrap:anywhere]',
    description: 'line-clamp-3 [overflow-wrap:anywhere]',
    site: 'flex items-center gap-1.5 text-muted',
    icon: 'size-4 shrink-0 rounded-sm object-contain',
    siteName: 'truncate',
  },
})

interface PanelImage {
  readonly hash: string
  readonly width: number
  readonly height: number
}

export interface LinkPreviewPanelProps {
  /** What a control's `aria-describedby` names while the panel is open. */
  readonly id: string
  readonly title: string
  readonly description: string | null
  readonly siteName: string | null
  /** The linked page's host, shown when the page did not name itself. */
  readonly host: string
  readonly thumbnail: PanelImage | null
  readonly favicon: PanelImage | null
  /** Where a stored picture is served from. */
  readonly imageUrl: (image: PanelImage) => string
  readonly ref?: Ref<HTMLDivElement>
}

/**
 * What a link goes to, as a small card (ADR-042, "Hover and focus peek").
 *
 * It is a tooltip, not a dialog: it holds nothing that can be pressed, so it
 * never takes focus, and what it says is what the link's `aria-describedby`
 * reads out. The pictures are decoration, with the dimensions they were stored
 * at so the card does not change size as they load. Where it hangs, and when,
 * is the caller's: this is only the card.
 */
export function LinkPreviewPanel({
  id,
  title,
  description,
  siteName,
  host,
  thumbnail,
  favicon,
  imageUrl,
  ref,
}: LinkPreviewPanelProps) {
  const styles = linkPreviewPanelStyles()
  return (
    <div ref={ref} id={id} role="tooltip" className={styles.panel()}>
      {thumbnail === null ? null : (
        <img
          className={styles.picture()}
          src={imageUrl(thumbnail)}
          alt=""
          width={thumbnail.width}
          height={thumbnail.height}
          decoding="async"
        />
      )}
      <div className={styles.body()}>
        <p className={styles.title()}>{title}</p>
        {description === null || description === '' ? null : (
          <p className={styles.description()}>{description}</p>
        )}
        <p className={styles.site()}>
          {favicon === null ? null : (
            <img
              className={styles.icon()}
              src={imageUrl(favicon)}
              alt=""
              width={favicon.width}
              height={favicon.height}
              decoding="async"
            />
          )}
          <span className={styles.siteName()}>{siteName ?? host}</span>
        </p>
      </div>
    </div>
  )
}
