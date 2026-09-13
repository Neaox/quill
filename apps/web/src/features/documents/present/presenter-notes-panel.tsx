import { Button, Spinner, tv } from '@quill/ui'

export const presenterNotesPanelStyles = tv({
  slots: {
    /*
     * A fixed measure, not a spacing multiple: every `w-*` utility scales with
     * the surface's density (`present.css`), and the presenter's card is the
     * one thing on this screen that is read from a laptop rather than from the
     * back of the room.
     */
    root: [
      'fixed end-20 bottom-18 z-40 flex w-[min(24rem,calc(100vw-4rem))] flex-col gap-2',
      'rounded-xl border border-border-strong bg-surface p-4 shadow-overlay',
    ],
    header: 'flex items-center justify-between gap-3',
    label: 'meta truncate',
    body: 'flex flex-col gap-2 text-sm leading-relaxed text-foreground',
    empty: 'text-sm leading-relaxed text-muted',
    footer: 'flex items-center justify-between gap-3 border-t border-border pt-2.5',
    reason: 'text-end text-2xs leading-snug text-muted',
  },
})

export interface PresenterNotesPanelProps {
  /** The section the notes belong to, counted from one, and its title. */
  readonly position: number
  readonly sectionTitle: string
  /** The `:::notes` text for this section, if the published source carries any. */
  readonly notes: string | undefined
  readonly isPending: boolean
  readonly onClose: () => void
}

/**
 * Presenter notes for the section on screen: the Present artboard's card,
 * bottom right, above the presenter bar.
 *
 * The room never sees this. It is chrome on the presenter's own screen, drawn
 * from `:::notes` in the published Markdown — a directive the renderer keeps
 * out of every reader-facing surface (`presenter-notes.ts`) — and it shows the
 * source text as written rather than rendering it, because a note is a line to
 * say out loud, not a document.
 */
export function PresenterNotesPanel({
  position,
  sectionTitle,
  notes,
  isPending,
  onClose,
}: PresenterNotesPanelProps) {
  const styles = presenterNotesPanelStyles()
  const paragraphs = (notes ?? '').split(/\n{2,}/).filter((line) => line.trim() !== '')

  return (
    <aside aria-label="Presenter notes" className={styles.root()}>
      <div className={styles.header()}>
        <p className={styles.label()}>{`Notes · §${position} ${sectionTitle}`}</p>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>

      {isPending ? (
        <Spinner className="size-4" />
      ) : paragraphs.length === 0 ? (
        <p className={styles.empty()}>
          No presenter notes for this section. Notes come from a <code>:::notes</code> block in the
          document, and are never shown to readers.
        </p>
      ) : (
        <div className={styles.body()}>
          {paragraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
      )}

      <div className={styles.footer()}>
        {/*
          TODO(M4): "note for later" captures a follow-up against whatever the
          presenter is pointing at and stores it as a private comment thread
          (quill-plan.md section 14), which needs the comment storage M4
          brings. Until then the control is disabled with its reason beside it,
          which is what `docs/design/feedback.md` asks of a control that cannot
          act yet — rather than a button that swallows the press.
        */}
        <Button size="sm" variant="secondary" disabled>
          Note for later
        </Button>
        <p className={styles.reason()}>Only you see this. Capturing notes arrives with comments.</p>
      </div>
    </aside>
  )
}
