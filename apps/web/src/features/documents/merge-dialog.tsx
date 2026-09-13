import { Button, Dialog, ScrollGroup, tv } from '@quill/ui'

import type { MergeConflict, MergeRequired } from '../../lib/api/index.ts'
import { shortRevision } from '../../lib/documents/revision-labels.ts'

export const mergeDialogStyles = tv({
  slots: {
    root: 'flex flex-col gap-5',
    explanation: 'text-sm leading-relaxed text-muted',
    conflict: 'flex flex-col gap-2',
    path: 'meta',
    texts: 'grid gap-3 @md:grid-cols-3',
    column: 'flex flex-col gap-1',
    columnLabel: 'meta',
    scroll: 'max-h-48 rounded-md border border-border bg-code-background',
    text: 'w-max min-w-full p-3 font-mono text-2xs leading-relaxed text-foreground',
  },
})

export interface MergeDialogProps {
  readonly merge: MergeRequired | undefined
  readonly onClose: () => void
  readonly onCompare: () => void
}

function ConflictTexts({ conflict }: { readonly conflict: MergeConflict }) {
  const styles = mergeDialogStyles()

  return (
    <div className={styles.conflict()}>
      <p className={styles.path()}>{conflict.path}</p>
      <div className={styles.texts()}>
        {[
          { key: 'base', label: 'what you started from', body: conflict.base },
          { key: 'ours', label: 'your version', body: conflict.ours },
          { key: 'theirs', label: 'the published version', body: conflict.theirs },
        ].map((side) => (
          <div key={side.key} className={styles.column()}>
            <p className={styles.columnLabel()}>{side.label}</p>
            <ScrollGroup label={side.label} className={styles.scroll()}>
              <pre className={styles.text()}>{side.body}</pre>
            </ScrollGroup>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * What to do when someone else published first.
 *
 * ADR-015 makes publish the only write, and a publish whose base is no longer
 * the head cannot simply win: the platform refuses and hands back the three
 * texts a person needs to decide — what the draft started from, what this
 * author wrote, and what is published now. There is no automatic merge and no
 * "force" button, because either would quietly discard somebody's work.
 */
export function MergeDialog({ merge, onClose, onCompare }: MergeDialogProps) {
  const styles = mergeDialogStyles()

  return (
    <Dialog
      title="Someone else published first"
      open={merge !== undefined}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      className="max-w-4xl @container"
      footer={
        <>
          <Button variant="secondary" onClick={onCompare}>
            See what changed
          </Button>
          <Button onClick={onClose}>Back to the editor</Button>
        </>
      }
    >
      <div className={styles.root()}>
        <p className={styles.explanation()}>
          This document was published again while you were writing, so your draft is based on an
          older revision ({shortRevision(merge?.current ?? '')} is current). Nothing has been lost
          and nothing has been changed: your draft is still saved. Bring the published wording into
          your draft where the two disagree, then publish again.
        </p>
        {merge?.conflicts.map((conflict) => (
          <ConflictTexts key={conflict.path} conflict={conflict} />
        ))}
      </div>
    </Dialog>
  )
}
