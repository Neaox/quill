import type { ReactNode } from 'react'

import { tv } from '../lib/class-names.ts'

export const presentBarStyles = tv({
  slots: {
    /*
     * Idle is a real attribute (`data-idle`), so the fade follows the
     * attribute rather than a class chosen in JavaScript
     * (`docs/architecture/styling.md`). The focus escape hatch is spelled
     * `data-idle:focus-within:` rather than a bare `focus-within:` so that it
     * out-specifies the faded state whatever order Tailwind emits the two in:
     * a presenter who tabs to a control must see the control they reached.
     */
    root: [
      'present-bar fixed inset-x-0 bottom-0 z-40 flex flex-wrap items-center justify-between',
      'gap-x-6 gap-y-2 px-10 py-3.5 transition-opacity duration-slow ease-standard',
      'data-idle:pointer-events-none data-idle:opacity-0',
      'data-idle:focus-within:pointer-events-auto data-idle:focus-within:opacity-100',
    ],
    identity: 'flex min-w-0 items-center gap-3.5 text-muted',
    title: 'truncate font-medium text-foreground',
    controls: 'flex flex-wrap items-center gap-5 text-muted',
    hint: 'inline-flex items-center gap-2 whitespace-nowrap',
    key: [
      'inline-flex h-5.5 min-w-5.5 items-center justify-center rounded-sm border',
      'border-border-strong bg-surface px-1.5 font-mono text-2xs text-muted',
    ],
  },
})

export interface PresentKeyProps {
  readonly children: ReactNode
}

/** One key on the presenter's keyboard, as the presenter bar names it. */
export function PresentKey({ children }: PresentKeyProps) {
  return <kbd className={presentBarStyles().key()}>{children}</kbd>
}

export interface PresentHintProps {
  /** The key or keys, as `PresentKey` elements. */
  readonly keys: ReactNode
  /** What pressing them does. */
  readonly children: ReactNode
}

/** A key and what it does, the shape every hint in the bar takes. */
export function PresentHint({ keys, children }: PresentHintProps) {
  return (
    <span className={presentBarStyles().hint()}>
      {keys}
      {children}
    </span>
  )
}

export interface PresentBarProps {
  /** The document being presented. */
  readonly title: string
  /** Where the presentation has got to, in words: "2 of 7". */
  readonly position: string
  /** Hints and controls, laid out at the end of the bar. */
  readonly children: ReactNode
  /** True once the room has been still long enough for the chrome to get out of the way. */
  readonly idle: boolean
  readonly className?: string | undefined
}

/**
 * The presenter bar: what is being presented, how far through it is, and the
 * keys that drive it. Quiet, at the bottom, and faded once the room has been
 * still for a moment (quill-plan.md section 14).
 *
 * Fading is opacity, never `display`, so nothing reflows when it returns and
 * the controls stay in the accessibility tree throughout; the pointer is
 * turned off with it so a faded bar cannot swallow a click meant for the
 * document. Reduced motion neutralises the transition globally
 * (`tokens.css`), which is why there is no media query here.
 */
export function PresentBar({ title, position, children, idle, className }: PresentBarProps) {
  const styles = presentBarStyles()

  return (
    <div data-idle={idle ? '' : undefined} className={styles.root({ className })}>
      <p className={styles.identity()}>
        <span className={styles.title()}>{title}</span>
        <span>{position}</span>
      </p>
      <div className={styles.controls()}>{children}</div>
    </div>
  )
}
