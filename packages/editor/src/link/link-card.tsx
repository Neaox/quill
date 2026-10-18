import { CopyIcon, ExternalIcon, PencilIcon, Tooltip, UnlinkIcon, buttonClassName } from '@quill/ui'
import type { IconProps } from '@quill/ui'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import type { EditorState } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { useEditorState } from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ComponentType, RefObject } from 'react'
import { createPortal } from 'react-dom'
import { tv } from 'tailwind-variants'

import type { ContextMenuEnvironment } from '../context-menu/context-menu-registry.ts'
import type { OverlayStore } from '../context-menu/overlay-store.ts'
import type { SelectionWatch } from '../format/selection-watch.ts'
import { linkAt, normaliseHref, unlink } from './link-commands.ts'
import { cardDetailsAction } from './link-display-actions.ts'
import type { LinkAction } from './link-display-actions.ts'
import { CardChoiceButtons, LinkDisplayButtons } from './link-display-controls.tsx'
import { linkTargetAt } from './link-display.ts'
import type { LinkTarget } from './link-display.ts'
import { linkOfferAt } from './link-offer.ts'
import { LinkPreviewLine } from './link-preview-line.tsx'

/**
 * The link card: a link's address, and Open, Edit, Copy and Unlink, shown
 * under a link when the caret is placed in it or the pointer rests on it —
 * the one place an author can see where a link goes without opening it.
 * Beneath them, how the link is shown (ADR-042: Link, Inline, Compact, Card,
 * Embed), what a card is made of, and where its preview stands.
 *
 * It does not take focus or steal keys: it is for the pointer and for the
 * eye, and the keyboard has the same actions in the link popover (Ctrl+K)
 * and the context menu. It goes while the author types, when the popover
 * opens, and while the offer after a pasted address is out.
 */

const card = tv({
  slots: {
    root:
      'link-card fixed z-40 flex max-w-[min(28rem,calc(100vw-1rem))] flex-col gap-1 rounded-md ' +
      'border border-border-strong/70 bg-surface-raised py-1 ps-2.5 pe-1 text-xs shadow-raised',
    row: 'flex min-w-0 flex-wrap items-center gap-1',
    address: 'min-w-0 flex-1 truncate text-foreground-soft',
    button: 'size-7 shrink-0 px-0',
    divider: 'h-px w-full bg-border',
  },
})

const styles = card()

/** How long the card waits after the pointer leaves, so it can be reached. */
export const LINK_CARD_LINGER_MS = 300

/** A link the card is about: where it is, where it goes, and how it is written. */
export interface CardLink {
  readonly from: number
  readonly to: number
  readonly href: string
  readonly form: LinkTarget['form']
}

export interface LinkCardProps {
  readonly editor: Editor
  readonly watch: SelectionWatch
  readonly store: OverlayStore
  readonly environment: ContextMenuEnvironment
  /** Opens the link popover on a link. */
  onEdit(link: CardLink): void
  /** Opens the own title and description of the card at `pos`. */
  onDetails(pos: number): void
}

/**
 * The link the caret is in, or the card that is selected. An ordinary link
 * counts from either end of its words, so the card is there as the caret
 * arrives at it.
 */
function caretLink(state: EditorState): CardLink | null {
  const target = linkTargetAt(state)
  if (target !== null && target.form !== 'mark') {
    return { from: target.from, to: target.to, href: target.href, form: target.form }
  }
  const { selection } = state
  if (!selection.empty) return null
  const mark = linkAt(state, selection.from)
  return mark === undefined ? null : { from: mark.from, to: mark.to, href: mark.href, form: 'mark' }
}

function sameLink(a: CardLink | null, b: CardLink | null): boolean {
  return a?.from === b?.from && a?.to === b?.to && a?.href === b?.href && a?.form === b?.form
}

/** The link under the pointer, from the DOM element it is drawn as. */
function linkUnder(view: EditorView, target: EventTarget | null): CardLink | undefined {
  if (!(target instanceof Element)) return undefined
  const anchor = target.closest('a')
  if (anchor === null) return undefined
  const mark = linkAt(view.state, view.posAtDOM(anchor, 0))
  return mark === undefined
    ? undefined
    : { from: mark.from, to: mark.to, href: mark.href, form: 'mark' }
}

/** The editor's state with the selection on the link, which is what the display commands act on. */
function selectingLink(state: EditorState, link: CardLink): EditorState {
  // An inline `:link` is selected inside its words; an ordinary link over them; a card as a block.
  const selection =
    link.form === 'leaf'
      ? NodeSelection.create(state.doc, link.from)
      : link.form === 'text'
        ? TextSelection.create(state.doc, link.from + 1, link.to - 1)
        : TextSelection.create(state.doc, link.from, link.to)
  return state.apply(state.tr.setSelection(selection))
}

/** Where the card hangs: under the link's first line, or under a card's block. */
function placeUnder(
  view: EditorView,
  link: CardLink,
): { readonly top: number; readonly left: number } {
  const block = link.form === 'leaf' ? view.nodeDOM(link.from) : null
  if (block instanceof HTMLElement) {
    const box = block.getBoundingClientRect()
    return { top: box.bottom, left: box.left }
  }
  const start = view.coordsAtPos(link.from, 1)
  return { top: start.bottom, left: start.left }
}

export function LinkCard({ editor, watch, store, environment, onEdit, onDetails }: LinkCardProps) {
  const atCaret = useEditorState({
    editor,
    selector: ({ editor: current }) => caretLink(current.state),
    equalityFn: sameLink,
  })
  const offered = useEditorState({
    editor,
    selector: ({ editor: current }) => linkOfferAt(current.state) !== null,
  })
  const facts = useSyncExternalStore(watch.subscribe, watch.getSnapshot)
  const overlay = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [hovered, setHovered] = useState<CardLink | undefined>(undefined)
  const root = useRef<HTMLDivElement | null>(null)
  const leaving = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Follows the pointer over links — DOM events ProseMirror does not report.
  useEffect(() => {
    const dom = editor.view.dom
    const onOver = (event: MouseEvent): void => {
      const link = linkUnder(editor.view, event.target)
      if (link === undefined) return
      clearTimeout(leaving.current)
      setHovered(link)
    }
    const onOut = (event: MouseEvent): void => {
      if (linkUnder(editor.view, event.target) === undefined) return
      clearTimeout(leaving.current)
      leaving.current = setTimeout(() => {
        setHovered(undefined)
      }, LINK_CARD_LINGER_MS)
    }
    dom.addEventListener('mouseover', onOver)
    dom.addEventListener('mouseout', onOut)
    return () => {
      clearTimeout(leaving.current)
      dom.removeEventListener('mouseover', onOver)
      dom.removeEventListener('mouseout', onOut)
    }
  }, [editor])

  const caret =
    atCaret !== null && facts.focused && !facts.typing && !facts.dismissed ? atCaret : undefined
  // Typing moves what a remembered link's positions point at, so the card waits; and the offer
  // after a pasted address is the one thing shown under that link.
  const link = overlay.kind === 'none' && !facts.typing && !offered ? (hovered ?? caret) : undefined

  const shown = link !== undefined
  // Follows the pointer on the card itself — DOM events, an external system:
  // it stays while the pointer is over it, lingers when it leaves, and a
  // press keeps the caret in the link.
  useEffect(() => {
    const element = root.current
    if (!shown || element === null) return undefined
    const stay = (): void => {
      clearTimeout(leaving.current)
    }
    const leave = (): void => {
      leaving.current = setTimeout(() => {
        setHovered(undefined)
      }, LINK_CARD_LINGER_MS)
    }
    const keepCaret = (event: MouseEvent): void => {
      event.preventDefault()
    }
    element.addEventListener('mouseenter', stay)
    element.addEventListener('mouseleave', leave)
    element.addEventListener('mousedown', keepCaret)
    return () => {
      element.removeEventListener('mouseenter', stay)
      element.removeEventListener('mouseleave', leave)
      element.removeEventListener('mousedown', keepCaret)
    }
  }, [shown])

  // Hangs the card under the link: layout the DOM owns.
  useLayoutEffect(() => {
    const element = root.current
    if (link === undefined || element === null) return
    try {
      const { top, left } = placeUnder(editor.view, link)
      const width = element.offsetWidth
      element.style.top = `${String(top + 6)}px`
      element.style.left = `${String(Math.max(8, Math.min(left, globalThis.innerWidth - width - 8)))}px`
    } catch {
      // No layout to measure against: a test, or a view that has gone.
    }
  }, [editor, link])

  if (link === undefined) return null

  return createPortal(
    <CardSurface
      rootRef={root}
      editor={editor}
      link={link}
      environment={environment}
      onEdit={onEdit}
      onDetails={onDetails}
      onDone={() => {
        setHovered(undefined)
      }}
    />,
    document.body,
  )
}

interface CardAction {
  readonly id: string
  readonly label: string
  readonly icon: ComponentType<IconProps>
  readonly disabledReason?: string | undefined
  run(): void
}

interface CardSurfaceProps {
  readonly rootRef: RefObject<HTMLDivElement | null>
  readonly editor: Editor
  readonly link: CardLink
  readonly environment: ContextMenuEnvironment
  onEdit(link: CardLink): void
  onDetails(pos: number): void
  /** The card has done what it was pressed for, and goes. */
  onDone(): void
}

/** The card itself, which follows every new state while it is out. */
function CardSurface({
  rootRef,
  editor,
  link,
  environment,
  onEdit,
  onDetails,
  onDone,
}: CardSurfaceProps) {
  // Every new state: what a link can be shown as follows more than the document, since an
  // embed's frame becomes known when its preview arrives.
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => current.state,
    equalityFn: (a, b) => a === b,
  })
  // What the display choices are read against and run on: this link, selected.
  const onLink = selectingLink(state, link)
  const target = linkTargetAt(onLink)
  const runChoice = (action: LinkAction): void => {
    editor.view.dispatch(editor.state.tr.setSelection(selectingLink(editor.state, link).selection))
    action.command(editor.state, editor.view.dispatch, editor.view)
    // The change was the card's, not typing, so the card stays on the link to show it: the
    // selection is set again, which is what tells the watch the author is not typing.
    editor.view.dispatch(editor.state.tr.setSelection(editor.state.selection))
    onDone()
    editor.view.focus()
  }
  const details = cardDetailsAction({
    openDetails: () => {
      onDetails(link.from)
    },
  })

  const actions: readonly CardAction[] = [
    {
      id: 'open',
      label: 'Open link',
      icon: ExternalIcon,
      disabledReason:
        environment.openLink === undefined ? 'Links cannot be opened here' : undefined,
      run: () => {
        environment.openLink?.(link.href)
      },
    },
    {
      id: 'edit',
      label: 'Edit link',
      icon: PencilIcon,
      run: () => {
        onEdit(link)
      },
    },
    {
      id: 'copy',
      label: 'Copy link',
      icon: CopyIcon,
      disabledReason:
        environment.copyText === undefined ? 'The clipboard is not available here' : undefined,
      run: () => {
        void environment.copyText?.(link.href)
      },
    },
    // A link with a display of its own goes back to an ordinary one with "Show as: Link" first.
    ...(link.form === 'mark'
      ? [
          {
            id: 'unlink',
            label: 'Unlink',
            icon: UnlinkIcon,
            run: () => {
              unlink(link.from, link.to)(editor.state, editor.view.dispatch)
              onDone()
            },
          },
        ]
      : []),
  ]

  // Only an address a document may carry is looked up; anything else is shown as text.
  const safe = normaliseHref(link.href) === link.href

  return (
    <div ref={rootRef} role="group" aria-label={`Link to ${link.href}`} className={styles.root()}>
      <div className={styles.row()}>
        <span className={styles.address()} title={link.href}>
          {link.href}
        </span>
        {actions.map((action) => {
          const Icon = action.icon
          return (
            <Tooltip key={action.id} content={action.disabledReason ?? action.label}>
              <button
                type="button"
                tabIndex={-1}
                aria-label={action.label}
                aria-disabled={action.disabledReason === undefined ? undefined : true}
                className={buttonClassName({
                  variant: 'ghost',
                  size: 'sm',
                  className: styles.button(),
                })}
                onClick={() => {
                  if (action.disabledReason === undefined) action.run()
                }}
              >
                <Icon />
              </button>
            </Tooltip>
          )
        })}
      </div>
      {target === null ? null : (
        <>
          <span aria-hidden="true" className={styles.divider()} />
          <div className={styles.row()}>
            <LinkDisplayButtons state={onLink} onRun={runChoice} tabbable={false} />
            {target.form === 'leaf' && target.display === 'card' ? (
              <CardChoiceButtons
                state={onLink}
                onRun={runChoice}
                details={details}
                tabbable={false}
              />
            ) : null}
          </div>
        </>
      )}
      {safe ? <LinkPreviewLine key={link.href} href={link.href} /> : null}
    </div>
  )
}
