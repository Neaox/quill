import type { ReactNode } from 'react'

import { Block, toast, tv } from '@quill/ui'

const section = tv({
  slots: {
    // The same offset an anchored heading in a document gets: the shell's bar
    // plus a step of air, declared once in `tokens.css` (review L4).
    block: 'scroll-mt-(--anchor-offset) pt-16',
    overline: 'meta text-accent',
    title: 'mt-1.5 font-display text-xl font-semibold tracking-tight text-foreground sm:text-2xl',
    description: 'mt-2 max-w-(--layout-wide) text-xs leading-relaxed text-muted',
    body: 'mt-6 flex flex-col gap-5',
  },
})

const specimen = tv({
  slots: {
    root: 'overflow-hidden rounded-lg border border-border bg-surface-raised',
    caption:
      'flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border bg-surface px-4 py-2',
    label: 'meta',
    note: 'text-2xs text-muted',
    body: 'p-4',
  },
})

export interface SectionProps {
  readonly id: string
  readonly overline: string
  readonly title: string
  readonly description: string
  readonly children: ReactNode
}

/** One titled part of the showcase, at the `wide` layout width. */
export function Section({ id, overline, title, description, children }: SectionProps) {
  const styles = section()

  return (
    <Block width="wide" className={styles.block()}>
      <section aria-labelledby={`${id}-title`} id={id}>
        <p className={styles.overline()}>{overline}</p>
        <h2 id={`${id}-title`} className={styles.title()}>
          {title}
        </h2>
        <p className={styles.description()}>{description}</p>
        <div className={styles.body()}>{children}</div>
      </section>
    </Block>
  )
}

/**
 * The one handler every inert-looking control in this showcase presses.
 *
 * A specimen keeps its enabled appearance on purpose — that is the point of
 * showing a button in every variant and state — but nothing interactive may
 * silently do nothing (`docs/design/feedback.md`, "Nothing interactive is
 * inert"; enforced here on by `quill/no-inert-control`). Pressing one tells
 * the reader the truth through the same `toast` module the real product
 * uses, instead of a copy of the same `onClick` at every call site.
 */
export function specimenAction(description: string): () => void {
  return () => {
    toast.info('Specimen', { description })
  }
}

export interface SpecimenProps {
  readonly label: string
  readonly note?: string
  readonly children: ReactNode
  readonly bodyClassName?: string
}

/**
 * A framed example.
 *
 * Every specimen gets the same frame, the same caption treatment, and the same
 * internal padding, so differences on this page are differences between the
 * components rather than between their presentations. The caption is in the
 * metadata face for the same reason a column heading is: it is a fact about
 * the example, not part of it.
 */
export function Specimen({ label, note, children, bodyClassName }: SpecimenProps) {
  const styles = specimen()

  // A `section` rather than a `div`: each specimen is a part of the page, and
  // an unnamed section also scopes a `header` inside it away from the banner
  // landmark, which is what lets the header variants be shown side by side.
  return (
    <section className={styles.root()}>
      <div className={styles.caption()}>
        <p className={styles.label()}>{label}</p>
        {note === undefined ? undefined : <p className={styles.note()}>{note}</p>}
      </div>
      <div className={styles.body({ className: bodyClassName })}>{children}</div>
    </section>
  )
}
