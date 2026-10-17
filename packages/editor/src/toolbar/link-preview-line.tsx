import { RelativeTime } from '@quill/ui'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { tv } from 'tailwind-variants'

import { useLinkPreviewSource } from '../blocks/link-preview-context.tsx'
import type { EditorLinkPreview, LinkRefreshOutcome } from '../blocks/link-preview-context.tsx'
import { toolbarStyles } from './toolbar-controls.tsx'

/**
 * The quiet line under a link's tools that says what is known about its preview
 * (ADR-042, "Authoring surface"): where it came from and how old it is, whether
 * it will show on the public site, and what to do when there is none.
 *
 * It is never an error in the page. A preview that is on its way, unavailable or
 * not allowed is a sentence here and the link stays the working link it was; a
 * refresh that is refused (too often, or by the organisation) is a status line
 * too. It renders only when the application can say where a preview stands
 * (`LinkPreviewSource.state`), so an editor wired to no previews shows nothing.
 */

const line = tv({
  slots: {
    root: [
      // Takes the toolbar's width without adding to it, so a long sentence wraps
      // beneath the tools instead of stretching the toolbar.
      'flex w-0 min-w-full basis-full flex-wrap items-center gap-x-2 gap-y-0.5 px-2 pb-0.5',
      'text-xs text-muted',
    ],
    warning: 'font-medium text-foreground-soft',
  },
})
const styles = line()
const buttons = toolbarStyles()

/** Where each layer's answer came from, in words an author knows. */
const LAYER_WORDS: Readonly<Record<string, string>> = {
  connector: 'Connector',
  oembed: 'oEmbed',
  'open-graph': 'Open Graph',
  'twitter-card': 'Twitter Card',
  page: 'The page itself',
}

/** The layers a stranger may be shown: everything except a connector, which sees private content. */
const PUBLIC_LAYERS: ReadonlySet<string> = new Set(['oembed', 'open-graph', 'twitter-card', 'page'])

const NOTICES: Readonly<Record<Exclude<LinkRefreshOutcome, 'started'>, string>> = {
  rate_limited: 'Refreshing too often. Try again in a few seconds.',
  blocked: 'Your organisation does not allow previews of this link.',
  failed: 'The preview could not be refreshed just now. The link still works.',
}

/** Why the public site will draw this plain, or null when it will show the preview. */
function publicSiteWarning(
  preview: EditorLinkPreview | null,
  publicSite: boolean | undefined,
): string | null {
  if (publicSite === false) {
    return 'Not shown on the public site: your organisation turned previews off there.'
  }
  if (preview?.layer !== undefined && !PUBLIC_LAYERS.has(preview.layer)) {
    return 'Not shown on the public site: only members can see it.'
  }
  return null
}

export interface LinkPreviewLineProps {
  /** The address of the link the caret is in. */
  readonly href: string
}

export function LinkPreviewLine({ href }: LinkPreviewLineProps) {
  const source = useLinkPreviewSource()
  // The author's own answer to "refresh", forgotten with the link it was about:
  // the toolbar keys this by address.
  const [notice, setNotice] = useState<string | null>(null)

  // Tells the application which address the author is looking at, so it can
  // find out how its preview stands. Idempotent; the application de-duplicates.
  useEffect(() => {
    source.request(href)
  }, [source, href])

  const state = source.state?.(href) ?? null
  if (state === null) return null

  const refresh = source.refresh
  const preview = source.preview(href)

  function refreshNow(): void {
    setNotice(null)
    if (refresh === undefined) return
    void refresh(href).then((outcome) => {
      setNotice(outcome === 'started' ? null : NOTICES[outcome])
    })
  }

  const action = (label: string): ReactNode =>
    refresh === undefined ? null : (
      <button
        type="button"
        data-toolbar-item=""
        className={buttons.button({ class: 'h-6 px-1.5 text-xs' })}
        disabled={source.refreshing === true}
        onMouseDown={(event) => {
          event.preventDefault()
        }}
        onClick={refreshNow}
      >
        {source.refreshing === true ? 'Refreshing…' : label}
      </button>
    )

  const warning = state === 'ready' ? publicSiteWarning(preview, source.publicSite) : null

  return (
    <div className={styles.root()}>
      {state === 'ready' ? (
        <>
          <span>
            {LAYER_WORDS[preview?.layer ?? ''] ?? preview?.layer ?? 'Fetched'}
            {preview?.fetchedAt === undefined ? null : (
              <>
                , fetched <RelativeTime value={preview.fetchedAt} />
              </>
            )}
          </span>
          {action('Refresh preview')}
        </>
      ) : null}
      {state === 'pending' ? <span>Fetching the preview…</span> : null}
      {state === 'unavailable' ? (
        <>
          <span>Preview unavailable.</span>
          {action('Retry')}
        </>
      ) : null}
      {state === 'blocked' ? (
        <span>Your organisation does not show previews for this link.</span>
      ) : null}
      {warning === null ? null : <span className={styles.warning()}>{warning}</span>}
      {notice === null ? null : <span role="status">{notice}</span>}
    </div>
  )
}
