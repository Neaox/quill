import { lazy, Suspense, type ReactNode } from 'react'

import { AssertiveAnnouncer } from './toast-tone.tsx'
import { toasterStyles, type ToasterPosition } from './toaster-styles.ts'

export { toasterStyles, type ToasterPosition }
export type { ToastTone } from './toast-tone.tsx'

/**
 * The toast host, loaded on demand.
 *
 * Everything that draws a toast — the library, its stack, its stylesheet — is
 * in `sonner-toaster.tsx`, and this is the only thing that imports it, with a
 * dynamic `import()`. So a reader who opens a document does not download a
 * toast stack in the graph that has to arrive before the document can be
 * drawn (review 2026-09-13, H1); the chunk is fetched straight afterwards, in
 * parallel, and the host mounts long before anything raises a toast.
 *
 * Deliberately *not* deferred until the first toast. A live region that is
 * inserted into the page with its message already inside it is unreliable to
 * announce, so the region has to exist first. Loading immediately and holding
 * the rare early call (`toast.ts` replays it) keeps both the saving and the
 * announcement.
 */
const ToastHost = lazy(() => import('./sonner-toaster.tsx'))

export interface ToasterProps {
  /** Where the stack anchors on the viewport. */
  readonly position?: ToasterPosition
  /**
   * Shows an explicit dismiss control on every toast. Defaults on: a reader
   * whose swipe gesture is turned off for reduced motion, or who is not
   * using a pointer at all, still needs a reachable way to close a toast
   * before its timer runs out.
   */
  readonly closeButton?: boolean
  readonly className?: string | undefined
}

/**
 * The toast stack. Mount once, near the app shell: every `toast.*` call in
 * `./toast.ts` renders into whichever `Toaster` is mounted.
 *
 * The assertive announcer is rendered here rather than in the chunk, because
 * it costs nothing and a `danger` toast raised in the first moments of a
 * session should be urgent even then (`docs/design/feedback.md`).
 */
export function Toaster({ position, closeButton, className }: ToasterProps): ReactNode {
  return (
    <>
      <Suspense fallback={null}>
        <ToastHost
          {...(position === undefined ? {} : { position })}
          {...(closeButton === undefined ? {} : { closeButton })}
          {...(className === undefined ? {} : { className })}
        />
      </Suspense>
      <AssertiveAnnouncer />
    </>
  )
}
