/**
 * Measuring the laid-out page without making the browser lay it out again
 * (quill-plan.md section 31).
 *
 * A floating control placed against the document reads where something is
 * and then writes where it goes. Done by each control in its own animation
 * frame callback, every read after another control's write is a forced
 * layout, and a long document is a dozen milliseconds a layout: pasting a
 * runbook with 240 tables laid the page out 240 times in one frame, 0.7 s.
 * Two strategies keep that to one layout, and none for what is off screen:
 *
 * - **A layout frame** (`createLayoutFrame`): every owner's read runs first,
 *   then every write, in one animation frame. An owner is measured once a
 *   frame however often it asks.
 * - **Nearness** (`viewportNearness`): one shared `IntersectionObserver` says
 *   which elements are near the screen, so a control far from it waits until
 *   it comes near rather than measuring now. Where nothing can say what is on
 *   screen (`alwaysNear`: jsdom, an old browser), everything is near.
 *
 * One of each per page (`pageLayoutFrame`, `pageNearness`), because frames
 * and the viewport are the page's.
 */

/** Writes what a read worked out; nothing when there is nothing to write. */
export type LayoutWrite = (() => void) | undefined

/** Reads the layout, and returns the writes that follow from it. */
export type LayoutRead = () => LayoutWrite

/** Where frames come from: the browser's animation frames, or a test's. */
export interface FrameHost {
  /** Calls back before the next paint; returns what cancels the request. */
  request(callback: () => void): () => void
}

export interface LayoutFrame {
  /** Measures for `owner` in the next frame, before any write; later calls replace earlier ones. */
  schedule(owner: object, read: LayoutRead): void
  /** Forgets `owner`'s pending measurement. */
  cancel(owner: object): void
}

export function createLayoutFrame(host: FrameHost): LayoutFrame {
  const pending = new Map<object, LayoutRead>()
  let cancelFrame: (() => void) | undefined

  const run = (): void => {
    cancelFrame = undefined
    const reads = [...pending.values()]
    pending.clear()
    const writes = reads.map((read) => read())
    for (const write of writes) write?.()
  }

  return {
    schedule(owner, read) {
      pending.set(owner, read)
      cancelFrame ??= host.request(run)
    },
    cancel(owner) {
      pending.delete(owner)
      if (pending.size === 0) {
        cancelFrame?.()
        cancelFrame = undefined
      }
    },
  }
}

const animationFrames: FrameHost = {
  request(callback) {
    const handle = requestAnimationFrame(callback)
    return () => {
      cancelAnimationFrame(handle)
    }
  },
}

let pageFrame: LayoutFrame | undefined

/** The page's layout frame. */
export function pageLayoutFrame(): LayoutFrame {
  pageFrame ??= createLayoutFrame(animationFrames)
  return pageFrame
}

/** Says when an element comes near the screen and when it leaves. */
export interface Nearness {
  /** Calls `change` with whether `element` is near, now or soon and on every change; returns what stops it. */
  watch(element: Element, change: (near: boolean) => void): () => void
}

/** Everything is near: where nothing can say what is on screen. */
export const alwaysNear: Nearness = {
  watch(_element, change) {
    change(true)
    return () => undefined
  },
}

/** How far outside the viewport an element counts as near: a screen either way. */
const NEAR = '100% 0px'

/** Nearness from one `IntersectionObserver` shared by every element watched. */
export function viewportNearness(Observer: typeof IntersectionObserver): Nearness {
  const watchers = new Map<Element, (near: boolean) => void>()
  let observer: IntersectionObserver | undefined
  const seen: IntersectionObserverCallback = (entries) => {
    for (const { target, isIntersecting } of entries) watchers.get(target)?.(isIntersecting)
  }
  return {
    watch(element, change) {
      observer ??= new Observer(seen, { rootMargin: NEAR })
      watchers.set(element, change)
      observer.observe(element)
      return () => {
        watchers.delete(element)
        observer?.unobserve(element)
      }
    },
  }
}

let pageNear: Nearness | undefined

/** The page's nearness, chosen the first time it is asked for. */
export function pageNearness(): Nearness {
  pageNear ??=
    typeof IntersectionObserver === 'undefined'
      ? alwaysNear
      : viewportNearness(IntersectionObserver)
  return pageNear
}

/**
 * Replaces the page's nearness, undefined meaning the default again; returns
 * what puts the previous one back. For a test of what waits to come near.
 */
export function setPageNearness(next: Nearness | undefined): () => void {
  const previous = pageNear
  pageNear = next
  return () => {
    pageNear = previous
  }
}
