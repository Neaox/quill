import { useEffect, useId, useLayoutEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { createPortal } from 'react-dom'

import { LinkPreviewPanel } from '@quill/ui'

import { linkPreviewImageUrl, useLinkPreview } from '../../../lib/api/index.ts'
import { useLinkPeekPreference } from '../../preferences/use-link-peek-preference.ts'
import { placePeek } from './place-peek.ts'
import { useLinkPeek } from './use-link-peek.ts'

export interface LinkPeekProps {
  /** The element the document's body is mounted in; its links are the ones peeked. */
  readonly host: RefObject<HTMLElement | null>
}

/** A device with no hover has no resting pointer to wait for, so a link is only a link there. */
function canHover(): boolean {
  return typeof window.matchMedia !== 'function' || window.matchMedia('(hover: hover)').matches
}

/**
 * The small card a link in a document shows while the pointer rests on it or
 * focus is on it (ADR-042). Nothing is drawn, and nothing is asked of the
 * server, until a link has been rested on: the preview is read only then.
 *
 * It follows the reader's preference, and says nothing at all for a link with
 * no preview (still being fetched, not allowed by the organisation, or a page
 * that has nothing to show): there is nothing a card could add.
 */
export function LinkPeek({ host }: LinkPeekProps) {
  const [choice] = useLinkPeekPreference()
  const { anchor, hold, release } = useLinkPeek(host, choice === 'on' && canHover())
  if (anchor === null || !anchor.isConnected) return null
  return <PeekCard key={anchor.href} anchor={anchor} onEnter={hold} onLeave={release} />
}

interface PeekCardProps {
  readonly anchor: HTMLAnchorElement
  readonly onEnter: () => void
  readonly onLeave: () => void
}

function PeekCard({ anchor, onEnter, onLeave }: PeekCardProps) {
  const id = useId()
  const view = useLinkPreview(anchor.href).data
  const wrapper = useRef<HTMLDivElement | null>(null)
  const ready = view?.state === 'ready'

  // Hangs the card by its link, once it has a size to place: layout belongs to
  // the browser, so this measures it rather than guessing.
  useLayoutEffect(() => {
    const element = wrapper.current
    if (element === null) return
    const { left, top } = placePeek(
      anchor.getBoundingClientRect(),
      { width: element.offsetWidth, height: element.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
    )
    element.style.left = `${left}px`
    element.style.top = `${top}px`
    element.classList.remove('invisible')
  })

  // The card is the link's description for as long as it is open, so what it
  // shows is not for the eye alone.
  useEffect(() => {
    if (!ready) return undefined
    anchor.setAttribute('aria-describedby', id)
    return () => anchor.removeAttribute('aria-describedby')
  }, [anchor, id, ready])

  if (view?.state !== 'ready') return null
  const { preview } = view
  return createPortal(
    <div
      ref={wrapper}
      // Placed once it is measured; until then it is not seen, and the layout effect shows it.
      className="invisible fixed z-50"
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
    >
      <LinkPreviewPanel
        id={id}
        title={preview.title}
        description={preview.description}
        siteName={preview.siteName}
        host={new URL(anchor.href).host}
        thumbnail={preview.thumbnail}
        favicon={preview.favicon}
        imageUrl={linkPreviewImageUrl}
      />
    </div>,
    document.body,
  )
}
