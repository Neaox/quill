import { Dialog, tv } from '@quill/ui'
import { useId } from 'react'

import { shortcutLabel } from '../format/shortcuts.ts'
import { SHORTCUT_GROUPS } from './shortcut-catalogue.ts'
import type { Shortcut, ShortcutGroup } from './shortcut-catalogue.ts'

/**
 * Every keyboard shortcut the editor has, in one place, opened with Ctrl+/ (⌘/ on a Mac).
 *
 * A modal dialog, so focus is held inside it and Escape closes it; each group is a labelled
 * region and each shortcut a term and its keys, so a screen reader hears "Bold, Ctrl+B" and can
 * move group by group. What it lists is `shortcut-catalogue.ts`, held to the keymap by a test.
 */

const styles = tv({
  slots: {
    groups: 'grid gap-x-10 gap-y-5 sm:grid-cols-2',
    title: 'mb-2 text-2xs font-semibold tracking-wide text-muted uppercase',
    list: 'm-0 flex flex-col gap-1.5',
    row: 'flex items-baseline justify-between gap-3',
    label: 'text-xs text-foreground',
    keys: 'm-0 flex shrink-0 flex-wrap justify-end gap-1',
    key: [
      'rounded-sm border border-border-strong bg-surface px-1.5 font-mono text-2xs leading-5',
      'text-foreground-soft',
    ],
  },
})

/** The keys of a shortcut, each as a key: what is typed, or the chord and then any other that does the same. */
function keysOf(shortcut: Shortcut): readonly string[] {
  return shortcut.kind === 'typed'
    ? [shortcut.text]
    : [shortcut.keys, ...shortcut.alternatives].map((binding) => shortcutLabel(binding))
}

function Group({ group }: { readonly group: ShortcutGroup }) {
  const headingId = useId()
  const classes = styles()
  return (
    <section aria-labelledby={headingId}>
      <h3 id={headingId} className={classes.title()}>
        {group.title}
      </h3>
      <dl className={classes.list()}>
        {group.shortcuts.map((shortcut) => (
          <div key={shortcut.label} className={classes.row()}>
            <dt className={classes.label()}>{shortcut.label}</dt>
            <dd className={classes.keys()}>
              {keysOf(shortcut).map((keys) => (
                <kbd key={keys} className={classes.key()}>
                  {keys}
                </kbd>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

export interface ShortcutsDialogProps {
  readonly open: boolean
  onOpenChange(open: boolean): void
  /** Called as it closes, to put the caret back where the writer was. */
  readonly onCloseAutoFocus?: (event: Event) => void
}

export function ShortcutsDialog({ open, onOpenChange, onCloseAutoFocus }: ShortcutsDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Keyboard shortcuts"
      description="Everything you can do from the keyboard while writing."
      className="w-[min(44rem,calc(100vw-2rem))]"
      {...(onCloseAutoFocus === undefined ? {} : { onCloseAutoFocus })}
    >
      <div className={styles().groups()}>
        {SHORTCUT_GROUPS.map((group) => (
          <Group key={group.title} group={group} />
        ))}
      </div>
    </Dialog>
  )
}
