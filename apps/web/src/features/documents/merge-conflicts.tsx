import { useId, useState, type ReactNode } from 'react'

import { Button, Dialog, tv } from '@quill/ui'
import {
  diffText,
  parseMarkdown,
  plainText,
  stringifyMdast,
  type ConflictResolution,
  type DocumentMerge,
} from '@quill/markdown'

import { SegmentedControl, type Segment } from '../theme/segmented-control.tsx'

export const mergeConflictsStyles = tv({
  slots: {
    root: 'flex flex-col gap-5 rounded-lg border border-border bg-surface-raised p-4 sm:p-5',
    heading: 'text-base font-semibold text-foreground',
    lede: 'text-sm leading-relaxed text-muted',
    list: 'flex flex-col gap-4',
    conflict: 'flex flex-col gap-3 border-t border-border pt-4',
    conflictHeading: 'text-sm font-semibold text-foreground',
    context: 'truncate text-xs text-muted italic',
    sides: 'grid gap-3 sm:grid-cols-2',
    side: 'flex min-w-0 flex-col gap-1',
    sideLabel: 'meta',
    text: [
      'max-h-64 overflow-auto rounded-md border border-border bg-code-background p-3',
      'font-mono text-xs leading-relaxed whitespace-pre-wrap break-words text-foreground',
    ],
    added: 'rounded-sm bg-success-subtle text-foreground underline decoration-success',
    removed: 'rounded-sm bg-danger-subtle text-muted line-through decoration-danger',
    gone: 'text-xs text-muted italic',
    choice: 'w-full max-w-md',
    editLabel: 'flex flex-col gap-1 text-xs font-medium text-foreground',
    editor: [
      'min-h-32 w-full rounded-md border border-border bg-surface p-3 font-mono text-xs',
      'leading-relaxed text-foreground focus-visible:outline-2 focus-visible:outline-focus-ring',
    ],
    actions: 'flex flex-wrap items-center gap-2 border-t border-border pt-4',
    hint: 'text-xs text-muted',
  },
})

type Choice = 'mine' | 'theirs' | 'both' | 'edit'

const CHOICES: readonly Segment<Choice>[] = [
  { value: 'mine', label: 'Keep mine' },
  { value: 'theirs', label: 'Keep theirs' },
  { value: 'both', label: 'Keep both' },
  { value: 'edit', label: 'Edit' },
]

type Blocks = DocumentMerge['merged']['children']

const markdownOf = (blocks: readonly Blocks[number][]): string =>
  blocks.length === 0 ? '' : stringifyMdast({ type: 'root', children: [...blocks] })

/** One side of a conflict, with what it changed from the base marked in words and lines. */
function SideText({ base, side }: { readonly base: string; readonly side: string }) {
  const styles = mergeConflictsStyles()
  return (
    <pre className={styles.text()}>
      {diffText(base, side).segments.map((segment, index): ReactNode => {
        const key = `${index}`
        if (segment.change === 'added') {
          return (
            <ins key={key} className={styles.added()}>
              {segment.text}
            </ins>
          )
        }
        if (segment.change === 'removed') {
          return (
            <del key={key} className={styles.removed()}>
              {segment.text}
            </del>
          )
        }
        return segment.text
      })}
    </pre>
  )
}

interface ConflictProps {
  readonly merge: DocumentMerge
  readonly position: number
  readonly otherName: string
  readonly choice: Choice | undefined
  readonly edit: string
  readonly onChoose: (choice: Choice) => void
  readonly onEdit: (text: string) => void
}

function Conflict({ merge, position, otherName, choice, edit, onChoose, onEdit }: ConflictProps) {
  const styles = mergeConflictsStyles()
  const headingId = useId()
  const conflict = merge.conflicts[position]
  if (conflict === undefined) return undefined
  const total = merge.conflicts.length
  const before = merge.merged.children[conflict.index - 1]
  const after = merge.merged.children[conflict.index]
  const base = markdownOf(conflict.base)
  const sides = [
    { key: 'theirs', label: `${otherName}’s version`, text: markdownOf(conflict.theirs) },
    { key: 'mine', label: 'Your version', text: markdownOf(conflict.mine) },
  ]

  return (
    <li>
      <article aria-labelledby={headingId} className={styles.conflict()}>
        <h3 id={headingId} className={styles.conflictHeading()}>
          Change {position + 1} of {total}
        </h3>
        {before === undefined ? undefined : (
          <p className={styles.context()}>
            <span className="sr-only">Just before: </span>
            {plainText(before)}
          </p>
        )}
        <div className={styles.sides()}>
          {sides.map((side) => (
            <figure key={side.key} className={styles.side()}>
              <figcaption className={styles.sideLabel()}>{side.label}</figcaption>
              {side.text === '' ? (
                <p className={styles.gone()}>Removed in this version.</p>
              ) : (
                <SideText base={base} side={side.text} />
              )}
            </figure>
          ))}
        </div>
        {after === undefined ? undefined : (
          <p className={styles.context()}>
            <span className="sr-only">Just after: </span>
            {plainText(after)}
          </p>
        )}
        <SegmentedControl
          legend={`What to keep for change ${position + 1}`}
          segments={CHOICES}
          value={choice}
          size="touch"
          className={styles.choice()}
          onValueChange={onChoose}
        />
        {choice === 'edit' ? (
          <label className={styles.editLabel()}>
            Your edit, in Markdown
            <textarea
              className={styles.editor()}
              value={edit}
              onChange={(event) => {
                onEdit(event.target.value)
              }}
            />
          </label>
        ) : undefined}
      </article>
    </li>
  )
}

function resolutionOf(choice: Choice | undefined, edit: string): ConflictResolution | undefined {
  switch (choice) {
    case undefined:
      return undefined
    case 'edit':
      return { kind: 'edited', blocks: parseMarkdown(edit).children }
    default:
      return { kind: choice }
  }
}

export interface MergeConflictsProps {
  readonly merge: DocumentMerge
  /** Whose draft the offline changes overlap with, as a name to show. */
  readonly otherName: string
  readonly onResolve: (resolutions: readonly ConflictResolution[]) => void
  /** Saves this author's version over the other draft: an explicit overwrite. */
  readonly onKeepMine: () => void
}

/**
 * The places where this author's offline changes and somebody else's overlap
 * (ADR-021, amendment of 2026-10-11). Everything else is already merged; here
 * each overlapping place is shown on its own — never the whole document
 * twice — with the block before and after it for context, the two versions
 * side by side with what each changed marked, and a choice: keep mine, keep
 * theirs, keep both (mine below theirs), or edit.
 *
 * Nothing is saved until every place has a choice. Keeping all of mine stays
 * possible, as an overwrite that says what it overwrites, behind a
 * confirmation.
 */
export function MergeConflicts({ merge, otherName, onResolve, onKeepMine }: MergeConflictsProps) {
  const styles = mergeConflictsStyles()
  const headingId = useId()
  const hintId = useId()
  const count = merge.conflicts.length
  const [choices, setChoices] = useState<readonly (Choice | undefined)[]>(() =>
    merge.conflicts.map(() => undefined),
  )
  const [edits, setEdits] = useState<readonly string[]>(() =>
    merge.conflicts.map((conflict) => markdownOf(conflict.mine)),
  )
  const [confirming, setConfirming] = useState(false)
  const resolutions = choices.map((choice, index) => resolutionOf(choice, edits[index] ?? ''))
  const chosen = resolutions.flatMap((resolution) => (resolution === undefined ? [] : [resolution]))
  const complete = chosen.length === count

  return (
    <section aria-labelledby={headingId} className={styles.root()}>
      <div>
        <h2 id={headingId} className={styles.heading()}>
          Your offline changes overlap with {otherName}’s
        </h2>
        <p className={styles.lede()}>
          Everything else has been merged. {count === 1 ? 'One place' : `${count} places`} changed
          on both sides; choose what to keep for each. Nothing is saved until you have, and your
          changes stay on this device until then.
        </p>
      </div>

      <ol className={styles.list()}>
        {merge.conflicts.map((conflict, position) => (
          <Conflict
            key={`${conflict.index}:${position}`}
            merge={merge}
            position={position}
            otherName={otherName}
            choice={choices[position]}
            edit={edits[position] ?? ''}
            onChoose={(choice) => {
              setChoices((current) =>
                current.map((value, index) => (index === position ? choice : value)),
              )
            }}
            onEdit={(text) => {
              setEdits((current) =>
                current.map((value, index) => (index === position ? text : value)),
              )
            }}
          />
        ))}
      </ol>

      <div className={styles.actions()}>
        <Button
          disabled={!complete}
          aria-describedby={complete ? undefined : hintId}
          onClick={() => {
            onResolve(chosen)
          }}
        >
          Save the merged draft
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            setConfirming(true)
          }}
        >
          Keep all of mine…
        </Button>
        {complete ? undefined : (
          <p id={hintId} className={styles.hint()}>
            Choose what to keep for every change to save.
          </p>
        )}
      </div>

      <Dialog
        title="Keep your version everywhere?"
        open={confirming}
        onOpenChange={setConfirming}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setConfirming(false)
              }}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirming(false)
                onKeepMine()
              }}
            >
              Replace {otherName}’s changes
            </Button>
          </>
        }
      >
        <p className={styles.lede()}>
          This saves your draft as it is over {otherName}’s.{' '}
          {count === 1
            ? `${otherName}’s change to the place shown above will be lost,`
            : `${otherName}’s changes to the ${count} places shown above will be lost,`}{' '}
          and so will anything else {otherName} changed that your draft does not have.
        </p>
      </Dialog>
    </section>
  )
}
