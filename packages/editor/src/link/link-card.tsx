import { CopyIcon, ExternalIcon, PencilIcon, Tooltip, UnlinkIcon, buttonClassName } from '@quill/ui'
import type { IconProps } from '@quill/ui'
import type { EditorView } from '@tiptap/pm/view'
import { useEditorState } from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ComponentType } from 'react'
import { createPortal } from 'react-dom'
import { tv } from 'tailwind-variants'

import type { ContextMenuEnvironment } from '../context-menu/context-menu-registry.ts'
import type { OverlayStore } from '../context-menu/overlay-store.ts'
import type { SelectionWatch } from '../format/selection-watch.ts'
import { linkAt, unlink } from './link-commands.ts'
import type { LinkRange } from './link-commands.ts'

/**
 * The link card: a link's address, and Open, Edit, Copy and Unlink, shown
 * under a link when the caret is placed in it or the pointer rests on it —
 * the one place an author can see where a link goes without opening it.
 *
 * It does not take focus or steal keys: it is for the pointer and for the
 * eye, and the keyboard has the same actions in the link popover (Ctrl+K).
 * It goes while the author types, and when the popover opens.
 */

const card = tv({
  slots: {
    root:
      'link-card fixed z-40 flex max-w-[min(28rem,calc(100vw-1rem))] items-center gap-1 rounded-md ' +
      'border border-border-strong/70 bg-surface-raised py-1 ps-2.5 pe-1 text-xs shadow-raised',
    address: 'min-w-0 truncate text-foreground-soft',
    button: 'size-7 shrink-0 px-0',
  },
})

const styles = card()

/** How long the card waits after the pointer leaves, so it can be reached. */
export const LINK_CARD_LINGER_MS = 300

export interface LinkCardProps {
  readonly editor: Editor
  readonly watch: SelectionWatch
  readonly store: OverlayStore
  readonly environment: ContextMenuEnvironment
  /** Opens the link popover on a link. */
  onEdit(link: LinkRange): void
}

/** The link the caret is in, compared by where it is and where it goes. */
function caretLink(editor: Editor): LinkRange | null {
  const { selection } = editor.state
  return selection.empty ? (linkAt(editor.state, selection.from) ?? null) : null
}

function sameLink(a: LinkRange | null, b: LinkRange | null): boolean {
  return a?.from === b?.from && a?.to === b?.to && a?.href === b?.href
}

/** The link under the pointer, from the DOM element it is drawn as. */
function linkUnder(view: EditorView, target: EventTarget | null): LinkRange | undefined {
  if (!(target instanceof Element)) return undefined
  const anchor = target.closest('a')
  if (anchor === null) return undefined
  return linkAt(view.state, view.posAtDOM(anchor, 0))
}

interface CardAction {
  readonly id: string
  readonly label: string
  readonly icon: ComponentType<IconProps>
  readonly disabledReason?: string | undefined
  run(): void
}

export function LinkCard({ editor, watch, store, environment, onEdit }: LinkCardProps) {
  const atCaret = useEditorState({
    editor,
    selector: ({ editor: current }) => caretLink(current),
    equalityFn: sameLink,
  })
  const facts = useSyncExternalStore(watch.subscribe, watch.getSnapshot)
  const overlay = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [hovered, setHovered] = useState<LinkRange | undefined>(undefined)
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
  // Typing moves what a remembered link's positions point at, so the card waits.
  const link = overlay.kind === 'none' && !facts.typing ? (hovered ?? caret) : undefined

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
      const start = editor.view.coordsAtPos(link.from, 1)
      const width = element.offsetWidth
      element.style.top = `${String(start.bottom + 6)}px`
      element.style.left = `${String(Math.max(8, Math.min(start.left, globalThis.innerWidth - width - 8)))}px`
    } catch {
      // No layout to measure against: a test, or a view that has gone.
    }
  }, [editor, link])

  if (link === undefined) return null

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
    {
      id: 'unlink',
      label: 'Unlink',
      icon: UnlinkIcon,
      run: () => {
        unlink(link.from, link.to)(editor.state, editor.view.dispatch)
        setHovered(undefined)
      },
    },
  ]

  return createPortal(
    <div ref={root} role="group" aria-label={`Link to ${link.href}`} className={styles.root()}>
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
    </div>,
    document.body,
  )
}
