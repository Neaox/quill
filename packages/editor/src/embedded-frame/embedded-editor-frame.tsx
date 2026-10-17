import { useEffect, useId, useRef } from 'react'
import type { ReactNode, Ref } from 'react'

import { CloseIcon, tv } from '@quill/ui'

/**
 * The full-screen surface an external editor runs in (ADR-043): the reading
 * surface's lightbox shell — the native `<dialog class="lightbox">` the
 * diagram and table viewers open, with its backdrop, its size, its phone
 * layout and its motion (`prose.css`, "Lightbox") — holding a bar that names
 * the editor and says what is happening, and the editor's own frame.
 *
 * The native modal dialog gives the focus trap, the inert page behind it and
 * the top layer. Its Escape is turned into a request rather than a close
 * (`onCloseRequest`), so the session decides whether closing would lose work
 * and asks first. Escape pressed inside the frame belongs to the editor.
 *
 * Generic: it knows nothing of draw.io. The protocol adapter supplies the
 * address, the sandbox (each token documented where it is chosen) and the
 * prompts shown over the frame (`children`), and talks to the frame through
 * `frameRef` and the frame channel (`frame-channel.ts`).
 */

export const embeddedEditorFrameStyles = tv({
  slots: {
    // The lightbox shell; `.embedded-editor` puts the bar above the frame.
    root: 'lightbox embedded-editor',
    bar: 'flex min-h-11 items-center gap-3 border-b border-border px-4 py-1.5',
    title: 'min-w-0 truncate text-sm font-semibold text-foreground',
    status: 'min-w-0 grow truncate text-xs text-muted',
    close: [
      'inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted',
      'transition-colors hover:bg-surface hover:text-foreground',
      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
    ],
    stage: 'relative min-h-0',
    frame: 'block size-full border-0 bg-surface',
    prompt: [
      'absolute inset-0 flex items-center justify-center p-4',
      'bg-[color-mix(in_oklch,var(--color-background)_55%,transparent)]',
    ],
  },
})

export interface EmbeddedEditorFrameProps {
  /** Names the dialog and the frame: "Draw.io diagram". */
  readonly title: string
  /** The editor page. */
  readonly src: string
  /** The frame's sandbox tokens; the adapter documents each. */
  readonly sandbox: string
  /** The frame's Permissions Policy, such as clipboard access. */
  readonly allow?: string
  readonly frameRef: Ref<HTMLIFrameElement>
  /** One line about the session — "Saving…", "Saved" — announced politely. */
  readonly status?: string
  /** Escape outside the frame, or the close button: the session decides. */
  onCloseRequest(): void
  /** Shown over the frame: a question the session needs answered. */
  readonly children?: ReactNode
}

export function EmbeddedEditorFrame({
  title,
  src,
  sandbox,
  allow,
  frameRef,
  status = '',
  onCloseRequest,
  children,
}: EmbeddedEditorFrameProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const styles = embeddedEditorFrameStyles()

  // The dialog is a DOM object with its own modal state, opened once on
  // mount and closed on unmount: synchronising with it is what an effect is
  // for. The page stops scrolling behind it as it does behind the lightbox.
  useEffect(() => {
    const dialog = dialogRef.current
    /* v8 ignore next -- the ref is set before effects run; the check narrows the type. */
    if (dialog === null) return
    dialog.showModal()
    document.documentElement.classList.add('lightbox-open')
    return () => {
      document.documentElement.classList.remove('lightbox-open')
      dialog.close()
    }
  }, [])

  return (
    <dialog
      ref={dialogRef}
      className={styles.root()}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault()
        onCloseRequest()
      }}
    >
      <div className={styles.bar()}>
        <h2 id={titleId} className={styles.title()}>
          {title}
        </h2>
        <p role="status" className={styles.status()}>
          {status}
        </p>
        <button
          type="button"
          className={styles.close()}
          aria-label={`Close ${title}`}
          onClick={onCloseRequest}
        >
          <CloseIcon />
        </button>
      </div>
      <div className={styles.stage()}>
        <iframe
          ref={frameRef}
          src={src}
          title={title}
          sandbox={sandbox}
          {...(allow === undefined ? {} : { allow })}
          referrerPolicy="no-referrer"
          className={styles.frame()}
        />
        {children === undefined ? undefined : <div className={styles.prompt()}>{children}</div>}
      </div>
    </dialog>
  )
}
