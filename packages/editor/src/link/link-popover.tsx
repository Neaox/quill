import {
  AnchoredPopover,
  Button,
  Combobox,
  CopyIcon,
  ExternalIcon,
  Input,
  UnlinkIcon,
} from '@quill/ui'
import type { ListboxGroup } from '@quill/ui'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import type { Command } from '@tiptap/pm/state'
import type { Editor } from '@tiptap/react'
import { useEffect, useId, useState } from 'react'
import type { FormEvent } from 'react'
import { tv } from 'tailwind-variants'

import type { ContextMenuEnvironment } from '../context-menu/context-menu-registry.ts'
import type { LinkOverlay, OverlayStore } from '../context-menu/overlay-store.ts'
import type { DocumentLinkTarget } from '../slash/slash-item.ts'
import { holdSelection } from './held-selection.ts'
import { applyLink, documentHref, linkAt, normaliseHref, unlink } from './link-commands.ts'
import { LINK_DISPLAY_CHOICES, NO_LINE_OF_ITS_OWN } from './link-display-actions.ts'
import type { LinkDisplayChoice } from './link-display-actions.ts'
import { blockDisplayFits, directiveLinkAt, inOneStep, showLinkAs } from './link-display.ts'
import type { DirectiveLinkTarget } from './link-display.ts'
import { LinkPreviewLine } from './link-preview-line.tsx'
import { openLinkDetails } from './open-link-popover.ts'

/**
 * Making and editing a link (Ctrl+K, the toolbar's Link, the link card's Edit).
 *
 * One field takes either an address or words to find a document by: what is
 * typed is offered as an address, and the application's document search
 * answers under it, so linking to another page is typing its title. A
 * document is linked by its id (`/d/<id>`, AGENTS.md rule 8). The link's
 * words are a field of their own, so a bare address need not be what the
 * reader sees. An existing link can be opened, copied or taken off from here
 * too, so the keyboard reaches everything the pointer's link card offers.
 *
 * How the link is shown (ADR-042: a plain link, inline with the page's title,
 * a compact line, a card) is a choice here too, one radio group, so the
 * keyboard reaches it: the address and the display are applied as one edit,
 * which one undo takes back. A link already written with a display of its
 * own keeps its address, which only changes as the plain link it can be
 * turned back into.
 */

const styles = tv({
  slots: {
    form: 'flex flex-col gap-3',
    actions: 'flex flex-wrap items-center gap-1.5',
    end: 'ms-auto',
    legend: 'mb-1 block text-xs font-medium text-foreground',
    // Native radios, so the group is one tab stop and the arrows move inside it. The
    // radio carries the state, and the label follows it.
    choices: 'flex flex-wrap items-center gap-0.5 rounded-sm bg-surface p-0.5',
    choice: [
      'relative inline-flex h-7 min-w-8 cursor-pointer items-center justify-center rounded-sm px-2 text-xs',
      'text-foreground transition-colors ease-standard hover:bg-surface-raised',
      'has-checked:bg-accent-subtle has-checked:text-accent',
      'has-focus-visible:outline-2 has-focus-visible:outline-offset-1 has-focus-visible:outline-focus-ring',
      'has-disabled:cursor-not-allowed has-disabled:opacity-40 has-disabled:hover:bg-transparent',
    ],
    radio: 'absolute inset-0 m-0 cursor-[inherit] appearance-none opacity-0',
  },
})()

/** How long typing rests before the document search is asked. */
export const LINK_SEARCH_DELAY_MS = 150

const ADDRESS_OPTION = 'address'

export interface LinkPopoverProps {
  readonly editor: Editor
  readonly overlay: LinkOverlay
  readonly store: OverlayStore
  readonly environment: ContextMenuEnvironment
  searchDocuments?(query: string, signal: AbortSignal): Promise<readonly DocumentLinkTarget[]>
}

/** Whether what was typed is an address, rather than words to find a document by. */
export function looksLikeAddress(typed: string): boolean {
  const value = typed.trim()
  return normaliseHref(value) !== value || /^([a-z][a-z\d+.-]*:|\/|#)/i.test(value)
}

interface Answer {
  readonly query: string
  readonly targets: readonly DocumentLinkTarget[]
}

/** The display the box starts from. An embed, which this box does not offer, reads as the card it falls back to. */
function displayChoice(directive: DirectiveLinkTarget | null): LinkDisplayChoice {
  if (directive === null) return 'url'
  return (
    LINK_DISPLAY_CHOICES.find((choice) => choice.display === directive.display)?.display ?? 'card'
  )
}

/** Selects the link just written, from where it starts to where the caret was left after it. */
function selectBackTo(from: number): Command {
  return (state, dispatch) => {
    dispatch?.(state.tr.setSelection(TextSelection.create(state.doc, from, state.selection.from)))
    return true
  }
}

/** Selects a link written as a directive: a card as a block, an inline link inside its words. */
function selectDirective(target: DirectiveLinkTarget): Command {
  return (state, dispatch) => {
    dispatch?.(
      state.tr.setSelection(
        target.form === 'leaf'
          ? NodeSelection.create(state.doc, target.from)
          : TextSelection.create(state.doc, target.from + 1),
      ),
    )
    return true
  }
}

export function LinkPopover({
  editor,
  overlay,
  store,
  environment,
  searchDocuments,
}: LinkPopoverProps) {
  const id = useId()
  const directive = directiveLinkAt(editor.state, overlay.from)
  const existing = directive === null ? linkAt(editor.state, overlay.from) : undefined
  const editingMark =
    existing !== undefined && existing.from <= overlay.from && existing.to >= overlay.to
  const editing = editingMark || directive !== null
  const initialHref = directive?.href ?? (editingMark ? existing.href : '')
  const [address, setAddress] = useState(initialHref)
  const [text, setText] = useState(() =>
    editingMark ? existing.text : editor.state.doc.textBetween(overlay.from, overlay.to, ' '),
  )
  const initialDisplay = displayChoice(directive)
  const [shownAs, setShownAs] = useState<LinkDisplayChoice>(initialDisplay)
  const [answer, setAnswer] = useState<Answer>({ query: '', targets: [] })
  const [error, setError] = useState<string | undefined>(undefined)
  const range = directive ?? (editingMark ? existing : overlay)
  const searchable =
    directive === null &&
    searchDocuments !== undefined &&
    address.trim() !== '' &&
    !looksLikeAddress(address)
  // What the search said about what is typed now; an answer to older words is not one.
  const found = searchable && answer.query === address ? answer.targets : []
  const searching = searchable && answer.query !== address
  // A card or a compact line needs a line of its own: a card already has one.
  const blockFits = directive?.form === 'leaf' || blockDisplayFits(editor.state)

  const { from: heldFrom, to: heldTo } = range
  // Synchronises the editor's view, an external system, with this box being
  // open: the words being linked stay drawn as selected while the fields have
  // the keyboard, and are let go when it closes.
  useEffect(() => {
    holdSelection(editor.view, { from: heldFrom, to: heldTo })
    return () => {
      if (!editor.isDestroyed) holdSelection(editor.view, null)
    }
  }, [editor, heldFrom, heldTo])

  // Asks the application's search — a request, an external system — once
  // typing rests, abandoning an answer the next keystroke has made stale.
  useEffect(() => {
    if (!searchable) return undefined
    const controller = new AbortController()
    const timer = setTimeout(() => {
      const settle = (targets: readonly DocumentLinkTarget[]): void => {
        if (!controller.signal.aborted) setAnswer({ query: address, targets })
      }
      searchDocuments(address, controller.signal).then(settle, () => {
        settle([])
      })
    }, LINK_SEARCH_DELAY_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [address, searchable, searchDocuments])

  const close = (): void => {
    store.close()
  }

  // The display is only changed when the author changed it, so an embed left alone stays one.
  const showing = shownAs === initialDisplay ? [] : [showLinkAs(shownAs)]

  const link = (href: string, words: string): void => {
    // Only ever an address or a document's: never empty, so it always applies.
    const linking = applyLink({ from: range.from, to: range.to, href, text: words })
    const command =
      showing.length === 0 ? linking : inOneStep(linking, selectBackTo(range.from), ...showing)
    command(editor.state, editor.view.dispatch)
    close()
  }

  const typedAddress = looksLikeAddress(address) ? normaliseHref(address) : ''

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (directive !== null) {
      // Its address stays; only how it is shown can change here.
      if (showing.length > 0) {
        inOneStep(selectDirective(directive), ...showing)(editor.state, editor.view.dispatch)
      }
      close()
      return
    }
    if (typedAddress === '') {
      setError('Paste an address, or choose a document from the list')
      return
    }
    link(typedAddress, text)
  }

  const groups: ListboxGroup[] = [
    ...(typedAddress === ''
      ? []
      : [
          {
            id: 'address',
            label: 'Address',
            options: [{ id: ADDRESS_OPTION, label: `Link to ${typedAddress}` }],
          },
        ]),
    ...(found.length === 0
      ? []
      : [
          {
            id: 'documents',
            label: 'Documents',
            options: found.map((target) => ({
              id: target.id,
              label: target.title,
              ...(target.context === undefined ? {} : { detail: target.context }),
            })),
          },
        ]),
  ]

  const choose = (optionId: string): void => {
    if (optionId === ADDRESS_OPTION) {
      link(typedAddress, text)
      return
    }
    for (const target of found) {
      if (target.id === optionId) link(documentHref(target.id), text === '' ? target.title : text)
    }
  }

  const href = directive?.href ?? (editingMark ? existing.href : undefined)
  // Only an address a document may carry is looked up; anything else is shown as text.
  const safe = href !== undefined && normaliseHref(href) === href

  return (
    <AnchoredPopover
      open
      anchor={overlay.anchor}
      label={editing ? 'Edit link' : 'Add link'}
      onOpenChange={close}
      onCloseFocus={() => {
        // Back to the words, unless the box gave way to another panel (a card's details).
        if (!editor.isDestroyed && store.getSnapshot().kind === 'none') editor.view.focus()
      }}
    >
      <form className={styles.form()} onSubmit={submit} aria-labelledby={`${id}-title`}>
        <h2 id={`${id}-title`} className="sr-only">
          {editing ? 'Edit link' : 'Add link'}
        </h2>
        {directive === null ? (
          <>
            <Combobox
              label="Link to"
              placeholder="Paste an address or find a document"
              value={address}
              onValueChange={(value) => {
                setAddress(value)
                setError(undefined)
              }}
              groups={groups}
              onSelect={choose}
              busy={searching}
              opens="on-request"
              error={error}
              status={
                searching
                  ? undefined
                  : found.length === 0
                    ? undefined
                    : `${String(found.length)} documents`
              }
              onDismiss={close}
            />
            <Input
              label="Text"
              value={text}
              placeholder="What the link reads as"
              onChange={(event) => {
                setText(event.target.value)
              }}
            />
          </>
        ) : (
          <Input
            label="Link to"
            value={directive.href}
            readOnly
            description="To change the address, show it as Link first."
          />
        )}
        <div>
          <span id={`${id}-shown`} className={styles.legend()}>
            Show link as
          </span>
          <div role="radiogroup" aria-labelledby={`${id}-shown`} className={styles.choices()}>
            {LINK_DISPLAY_CHOICES.map(({ display, label, description }) => {
              const unavailable = !blockFits && (display === 'card' || display === 'compact')
              return (
                <label key={display} className={styles.choice()} title={description}>
                  <input
                    type="radio"
                    name={`${id}-display`}
                    className={styles.radio()}
                    aria-label={label}
                    checked={shownAs === display}
                    disabled={unavailable}
                    aria-describedby={unavailable ? `${id}-why` : undefined}
                    onChange={() => {
                      setShownAs(display)
                    }}
                  />
                  {label}
                </label>
              )
            })}
          </div>
          {blockFits ? null : (
            <span id={`${id}-why`} className="sr-only">
              {NO_LINE_OF_ITS_OWN}
            </span>
          )}
        </div>
        {safe ? <LinkPreviewLine key={href} href={href} /> : null}
        <div className={styles.actions()}>
          {editing ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                iconStart={<ExternalIcon />}
                onClick={() => {
                  if (href !== undefined) environment.openLink?.(href)
                }}
                disabled={environment.openLink === undefined}
              >
                Open
              </Button>
              <Button
                variant="ghost"
                size="sm"
                iconStart={<CopyIcon />}
                onClick={() => {
                  if (href !== undefined) void environment.copyText?.(href)
                }}
                disabled={environment.copyText === undefined}
              >
                Copy
              </Button>
              {editingMark ? (
                <Button
                  variant="ghost"
                  size="sm"
                  iconStart={<UnlinkIcon />}
                  onClick={() => {
                    unlink(existing.from, existing.to)(editor.state, editor.view.dispatch)
                    close()
                  }}
                >
                  Unlink
                </Button>
              ) : null}
              {directive?.form === 'leaf' && directive.display === 'card' ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    openLinkDetails(editor.view, store, directive.from)
                  }}
                >
                  Preview details…
                </Button>
              ) : null}
            </>
          ) : null}
          <Button type="submit" size="sm" className={styles.end()}>
            {editing ? 'Save' : 'Link'}
          </Button>
        </div>
      </form>
    </AnchoredPopover>
  )
}
