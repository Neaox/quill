import { Button, Spinner, tv } from '@quill/ui'

export const presenterNotesStyles = tv({
  slots: {
    // The notes are what the presenter reads while presenting: they take the room the rest leaves, and scroll in it.
    root: 'flex min-h-0 flex-col gap-2 overflow-hidden rounded-xl border border-border-strong bg-surface p-4',
    header: 'flex shrink-0 items-center justify-between gap-3',
    label: 'meta truncate',
    body: 'flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto text-base leading-relaxed text-foreground md:text-lg xl:text-2xl',
    // A placeholder, not a message: quieter than the notes it stands in for, so a section with none reads as empty rather than as an instruction.
    empty: 'text-xs leading-relaxed text-muted/80 italic',
    // Last to be drawn: a control that is not built yet gives way to the notes.
    footer:
      'presenter-aside-only shrink-0 items-center justify-between gap-3 border-t border-border pt-2.5',
    reason: 'text-end text-2xs leading-snug text-muted',
  },
  variants: {
    // Nothing to read: one line, so the room goes to the slides, as a speaker with none is speaking to them.
    bare: {
      true: {
        root: 'flex-row items-center justify-between gap-3 rounded-lg px-3 py-2',
      },
    },
  },
})

export interface PresenterNotesProps {
  readonly className?: string | undefined
  /** The section the notes belong to, counted from one, and its title. */
  readonly position: number
  readonly sectionTitle: string
  /** The `:::notes` text for this section, if the published source carries any. */
  readonly notes: string | undefined
  readonly isPending: boolean
}

/**
 * Presenter notes for the section being presented, in the presenter window.
 *
 * Only there (ADR-050): drawn from `:::notes` in the published Markdown, a directive the renderer
 * keeps out of every reader-facing surface (`presenter-notes.ts`), and shown as the source text
 * written, because a note is a line to say out loud, not a document. The window the room sees never
 * draws it, so the room cannot see it.
 */
export function PresenterNotes({
  className,
  position,
  sectionTitle,
  notes,
  isPending,
}: PresenterNotesProps) {
  const paragraphs = (notes ?? '').split(/\n{2,}/).filter((line) => line.trim() !== '')
  const bare = !isPending && paragraphs.length === 0
  const styles = presenterNotesStyles({ bare })

  if (bare) {
    return (
      <aside aria-label="Presenter notes" data-bare="true" className={styles.root({ className })}>
        <p className={styles.empty()}>
          No presenter notes for this section. Notes come from a <code>:::notes</code> block in the
          document, and are never shown to readers.
        </p>
        {/* TODO(M4): see below; until then disabled, with its reason, beside the line it belongs to. */}
        <Button
          size="sm"
          variant="secondary"
          disabled
          title="Only you see this. Capturing notes arrives with comments."
        >
          Note for later
        </Button>
      </aside>
    )
  }

  return (
    <aside aria-label="Presenter notes" className={styles.root({ className })}>
      <div className={styles.header()}>
        <p className={styles.label()}>{`Notes · §${String(position)} ${sectionTitle}`}</p>
      </div>

      {isPending ? (
        <Spinner className="size-4" />
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
