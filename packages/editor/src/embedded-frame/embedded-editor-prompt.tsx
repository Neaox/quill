import { useEffect, useId, useRef } from 'react'
import type { ReactNode } from 'react'

import { tv } from '@quill/ui'

/**
 * A question the session asks over the editor's frame — "Close without
 * saving?", "Somebody saved a newer version" — with the choices as buttons.
 *
 * An `alertdialog` inside the editor's dialog: it is announced when it
 * appears, and focus moves to it so the choice can be made from the keyboard
 * without hunting for it behind the frame. The first action is the safe one.
 */

const promptStyles = tv({
  slots: {
    root: [
      'flex w-[min(28rem,100%)] flex-col gap-3 rounded-lg border border-border',
      'bg-surface-raised p-5 shadow-dialog focus-visible:outline-none',
    ],
    title: 'text-base leading-snug font-semibold tracking-tight text-foreground',
    body: 'text-xs leading-relaxed text-muted',
    actions: 'mt-1 flex flex-wrap justify-end gap-2',
  },
})

export interface EmbeddedEditorPromptProps {
  readonly title: string
  readonly children: ReactNode
  /** The choices, safest first. */
  readonly actions: ReactNode
}

export function EmbeddedEditorPrompt({ title, children, actions }: EmbeddedEditorPromptProps) {
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const bodyId = useId()
  const styles = promptStyles()

  // Focus is a DOM state outside React; the question takes it when it appears.
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('button')?.focus()
  }, [])

  return (
    <div
      ref={ref}
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      className={styles.root()}
    >
      <h3 id={titleId} className={styles.title()}>
        {title}
      </h3>
      <div id={bodyId} className={styles.body()}>
        {children}
      </div>
      <div className={styles.actions()}>{actions}</div>
    </div>
  )
}
