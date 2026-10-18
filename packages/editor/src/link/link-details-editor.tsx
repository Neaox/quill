import { AnchoredPopover, Button, Input } from '@quill/ui'
import { NodeSelection } from '@tiptap/pm/state'
import type { Command } from '@tiptap/pm/state'
import type { Editor } from '@tiptap/react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { tv } from 'tailwind-variants'

import { useLinkPreviewSource } from '../blocks/link-preview-context.tsx'
import type { EditorLinkPreview } from '../blocks/link-preview-context.tsx'
import type { LinkDetailsOverlay, OverlayStore } from '../context-menu/overlay-store.ts'
import { directiveLinkAt, inOneStep, setLinkChoice } from './link-display.ts'

/**
 * Preview details: the words on a card that the author may replace (ADR-042).
 *
 * The fetched title and description are shown as the fields' placeholders, so
 * the author sees what is there before choosing to say something different, and
 * an empty field means "use the page's". A description can also be hidden
 * altogether, which is a choice of its own and not an empty field. "Reset to
 * fetched" gives both back at once. This also repairs a page whose tags are wrong
 * or missing, and gives a stable result where the host blocks us.
 *
 * It opens in a small panel against the card (`LinkDetailsPopover`), from the
 * link card's "Details" and the context menu's "Preview details…"; the panel
 * puts focus in the first field, and Escape gives up from anywhere in it.
 */

const details = tv({
  slots: {
    form: 'flex flex-col gap-3',
    check: 'flex items-center gap-2 text-xs text-foreground',
    box: 'size-4 accent-[var(--color-accent)]',
    actions: 'flex flex-wrap items-center gap-1.5',
    end: 'ms-auto',
  },
})
const styles = details()

export interface CardDetails {
  /** The author's own title, or null to use the page's. */
  readonly title: string | null
  /** The author's own description; the empty string hides it; null uses the page's. */
  readonly description: string | null
}

export interface LinkDetailsEditorProps {
  readonly current: CardDetails
  /** What the page itself says, shown where the author's own words would go. */
  readonly fetched: EditorLinkPreview | null
  onApply(details: CardDetails): void
  onReset(): void
  onCancel(): void
}

export function LinkDetailsEditor({
  current,
  fetched,
  onApply,
  onReset,
  onCancel,
}: LinkDetailsEditorProps) {
  const [title, setTitle] = useState(current.title ?? '')
  const [description, setDescription] = useState(current.description ?? '')
  const [hidden, setHidden] = useState(current.description === '')

  function submit(event: FormEvent): void {
    event.preventDefault()
    const own = description.trim()
    onApply({
      title: title.trim() === '' ? null : title.trim(),
      description: hidden ? '' : own === '' ? null : own,
    })
  }

  return (
    <form className={styles.form()} onSubmit={submit}>
      <Input
        label="Card title"
        autoComplete="off"
        placeholder={fetched?.title ?? 'Title'}
        value={title}
        onChange={(event) => {
          setTitle(event.target.value)
        }}
      />
      <Input
        label="Card description"
        autoComplete="off"
        placeholder={fetched?.description ?? 'Description'}
        disabled={hidden}
        value={description}
        onChange={(event) => {
          setDescription(event.target.value)
        }}
      />
      <label className={styles.check()}>
        <input
          type="checkbox"
          className={styles.box()}
          checked={hidden}
          onChange={(event) => {
            setHidden(event.target.checked)
          }}
        />
        No description
      </label>
      <div className={styles.actions()}>
        <Button variant="ghost" size="sm" onClick={onReset}>
          Reset to fetched
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" className={styles.end()}>
          Apply
        </Button>
      </div>
    </form>
  )
}

export interface LinkDetailsPopoverProps {
  readonly editor: Editor
  readonly overlay: LinkDetailsOverlay
  readonly store: OverlayStore
}

/** Selects the card at `pos`, which is what the choice commands act on. */
function selectCard(pos: number): Command {
  return (state, dispatch) => {
    dispatch?.(state.tr.setSelection(NodeSelection.create(state.doc, pos)))
    return true
  }
}

/** The card's own title and description, in a panel against the card. */
export function LinkDetailsPopover({ editor, overlay, store }: LinkDetailsPopoverProps) {
  const target = directiveLinkAt(editor.state, overlay.pos)
  const fetched = useLinkPreviewSource().preview(target?.href ?? '')
  const close = (): void => {
    store.close()
  }
  /* v8 ignore next -- the panel is opened on a card, and closes when anything else is pressed. */
  if (target === null) return null
  const { title, description } = target.link.choice
  const apply = (choice: CardDetails): void => {
    // One undo takes the change back.
    inOneStep(selectCard(target.from), setLinkChoice(choice))(editor.state, editor.view.dispatch)
    close()
  }
  return (
    <AnchoredPopover
      open
      anchor={overlay.anchor}
      label="Preview details"
      onOpenChange={close}
      onCloseFocus={() => {
        if (!editor.isDestroyed) editor.view.focus()
      }}
    >
      <LinkDetailsEditor
        current={{ title, description }}
        fetched={fetched}
        onApply={apply}
        onReset={() => {
          apply({ title: null, description: null })
        }}
        onCancel={close}
      />
    </AnchoredPopover>
  )
}
