/**
 * What the writing surface is showing over the document, besides the slash
 * menu: the context menu, the link popover, a card's preview details, or the
 * alternative-text field.
 *
 * One at a time, so it is one state, a discriminated union, held outside
 * React like the slash menu's (`slash/slash-store.ts`): ProseMirror plugins
 * open these from key and pointer handlers React never sees, and the
 * components read the store through `useSyncExternalStore`.
 */

/** A box in the viewport's pixels; a point is a box of no size. */
export interface OverlayAnchor {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface ContextMenuOverlay {
  readonly kind: 'context-menu'
  readonly anchor: OverlayAnchor
  /** `sheet` when it was opened by a long press on a touch screen. */
  readonly presentation: 'menu' | 'sheet'
  /** The document position it acts on. */
  readonly pos: number
  /** Only these contributions, for a menu opened from one control: a callout's type button. */
  readonly only?: readonly string[]
  /** What the menu is for, which names it. */
  readonly label: string
  /** Where focus goes back to when it closes. */
  returnFocus(): void
}

export interface LinkOverlay {
  readonly kind: 'link'
  readonly anchor: OverlayAnchor
  /** The words being linked, or the link being edited. */
  readonly from: number
  readonly to: number
}

/** A link card's own title and description (ADR-042). */
export interface LinkDetailsOverlay {
  readonly kind: 'link-details'
  readonly anchor: OverlayAnchor
  /** The card. */
  readonly pos: number
}

export interface AltTextOverlay {
  readonly kind: 'alt-text'
  readonly anchor: OverlayAnchor
  /** The image. */
  readonly pos: number
}

export type Overlay = ContextMenuOverlay | LinkOverlay | LinkDetailsOverlay | AltTextOverlay

export type OverlaySnapshot = Overlay | { readonly kind: 'none' }

const NONE: OverlaySnapshot = { kind: 'none' }

export interface OverlayStore {
  subscribe(listener: () => void): () => void
  getSnapshot(): OverlaySnapshot
  open(overlay: Overlay): void
  close(): void
}

export function createOverlayStore(): OverlayStore {
  const listeners = new Set<() => void>()
  let snapshot: OverlaySnapshot = NONE
  const publish = (next: OverlaySnapshot): void => {
    snapshot = next
    for (const listener of listeners) listener()
  }
  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getSnapshot: () => snapshot,
    open: publish,
    close() {
      if (snapshot.kind !== 'none') publish(NONE)
    },
  }
}

/** A DOM box as an anchor. */
export function anchorOf(rect: {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}): OverlayAnchor {
  return { x: rect.left, y: rect.top, width: rect.width, height: rect.height }
}
