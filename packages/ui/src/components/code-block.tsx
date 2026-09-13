import type { ReactNode } from 'react'

import { tv } from '../lib/class-names.ts'

/**
 * The frame is the artboard's: a monospace strip naming the source, then the
 * code on its own surface. Token colours arrive from the theme through
 * `--token-*`, so a code block looks right under every identity with nothing
 * of its own to change.
 */
export const codeBlockStyles = tv({
  slots: {
    root: 'my-0 overflow-hidden rounded-lg border border-border bg-code-background',
    caption:
      'meta-value flex items-center justify-between gap-3 border-b border-border px-3 py-1.5',
    source: 'truncate',
    actions: 'flex shrink-0 items-center gap-1',
    pre: [
      'overflow-x-auto px-3.5 py-3 text-xs leading-relaxed text-foreground',
      'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring',
    ],
    code: 'font-mono [font-variant-ligatures:none]',
  },
})

export interface CodeBlockProps {
  /**
   * The code. Either plain text, or the `tok-*` spans a highlighted block is
   * made of (ADR-030). This component chooses neither the tokenizer nor the
   * presentation: it is given elements and it frames them.
   */
  readonly children: ReactNode
  /** Where the code came from: a path, a revision, a line range. */
  readonly source?: string | undefined
  /** Names the scroll region, so a keyboard user knows what they are in. */
  readonly label: string
  /** Copy, open in the editor, and so on. */
  readonly actions?: ReactNode | undefined
  readonly className?: string | undefined
}

/**
 * A fenced code block.
 *
 * A block scrolls sideways rather than wrapping, so it is focusable and
 * reachable without a pointer, and it is a labelled group so what is being
 * scrolled is announced.
 */
export function CodeBlock({ children, source, label, actions, className }: CodeBlockProps) {
  const styles = codeBlockStyles()

  return (
    <figure className={styles.root({ className })}>
      {source === undefined && actions === undefined ? undefined : (
        <figcaption className={styles.caption()}>
          <span className={styles.source()}>{source}</span>
          {actions === undefined ? undefined : <span className={styles.actions()}>{actions}</span>}
        </figcaption>
      )}

      <pre tabIndex={0} role="group" aria-label={label} className={styles.pre()}>
        <code className={styles.code()}>{children}</code>
      </pre>
    </figure>
  )
}
