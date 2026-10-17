import type { Command, EditorState } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import type { Editor } from '@tiptap/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { commentAction } from '../actions/block-actions.ts'
import type { EditorAction } from '../actions/editor-action.ts'
import { linkActions } from '../actions/link-actions.ts'
import { LINK_DISPLAY_CHOICES, cardDetailsAction } from '../actions/link-display-actions.ts'
import type { LinkDisplayChoice } from '../actions/link-display-actions.ts'
import { useLinkPreviewSource } from '../blocks/link-preview-context.tsx'
import {
  blockDisplayFits,
  inOneStep,
  linkTargetAt,
  setLinkChoice,
  showLinkAs,
} from '../link/link-display.ts'
import type { LinkTarget } from '../link/link-display.ts'
import type { CommentRequest } from '../block/comment-request.ts'
import type { Rect } from '../floating/placement.ts'
import { useFloatingPlacement } from '../floating/use-floating-placement.ts'
import { applyLink, unlink } from '../format/links.ts'
import { holdSelectionMeta, releaseSelectionMeta } from './held-selection.ts'
import { useEditorFocus, useEditorSnapshot, useFocusWithin, useRunAction } from './hooks.ts'
import type { LinkEditing } from './hooks.ts'
import { LinkDetailsEditor } from './link-details-editor.tsx'
import { LinkEditor } from './link-editor.tsx'
import { TableToolbarContent } from './table-toolbar-content.tsx'
import {
  CalloutToolbarContent,
  LinkToolbarContent,
  TextToolbarContent,
} from './toolbar-contents.tsx'
import { toolbarStyles } from './toolbar-controls.tsx'
import { targetKey, toolbarTarget } from './toolbar-target.ts'
import type { ToolbarTarget } from './toolbar-target.ts'
import { focusToolbar, handleToolbarKey } from './use-toolbar-keys.ts'

/**
 * The floating toolbar: the tools for whatever the author is pointing at.
 *
 * Select text and it offers formatting and a link; rest the caret in a link and
 * it offers to change or remove it; be in a table and it offers the table's tools, or
 * a row's or a column's once its grip has picked one out; be in a callout and it
 * offers its tools. Which of those it is comes from `toolbarTarget`, a pure
 * function of the editor state, and what each holds is a short list over the
 * shared action registries (`toolbar-contents.tsx`, `table-toolbar-content.tsx`).
 *
 * It must not steal the selection it exists to act on: its buttons act on press
 * without taking focus. It stays up while the author is *using* it, though — a
 * press on it, or focus inside it, as in the link box — and goes away when focus
 * is somewhere else. For the keyboard, Alt+F10 moves focus into it, the arrows
 * move between its controls, and Escape goes back to the document.
 */

/** The height a toolbar needs above its anchor, with the gap, for the table's to be held clear of the page's chrome. */
const TOOLBAR_ROOM = 48

const LABELS: Readonly<Record<ToolbarTarget['kind'], string>> = {
  text: 'Text formatting',
  link: 'Link',
  table: 'Table',
  callout: 'Callout',
}

/** The box around a range of text. */
function rangeRect(view: EditorView, from: number, to: number): Rect {
  const start = view.coordsAtPos(from)
  const end = view.coordsAtPos(to)
  return {
    top: Math.min(start.top, end.top),
    bottom: Math.max(start.bottom, end.bottom),
    left: Math.min(start.left, end.left),
    right: Math.max(start.right, end.right),
  }
}

/**
 * Where the toolbar hangs, read from the editor as it is *now* so that it keeps
 * up with a page that scrolls. A range of text is a box to centre on; a block is
 * only its top edge, so the toolbar sits above a callout rather than below the
 * end of a long one.
 */
function locateTarget(editor: Editor, target: ToolbarTarget): Rect | null {
  switch (target.kind) {
    case 'text':
      return rangeRect(editor.view, target.from, target.to)
    case 'link':
      // A card is a block and has no text range to centre on; an inline directive's range
      // is its node, so the toolbar hangs from the words inside it.
      if (target.form === 'leaf') return topEdge(editor.view, target.from)
      return target.form === 'text'
        ? rangeRect(editor.view, target.from + 1, target.to - 1)
        : rangeRect(editor.view, target.from, target.to)
    case 'table':
      return tableTop(editor.view, target.tablePos)
    case 'callout':
      return topEdge(editor.view, target.callout.pos)
  }
}

/** The top edge of the block that starts at `pos`; null if the browser has drawn nothing there. */
function topEdge(view: EditorView, pos: number): Rect | null {
  const dom = view.nodeDOM(pos)
  if (!(dom instanceof Element)) return null
  const { top, left, right } = dom.getBoundingClientRect()
  return { top, bottom: top, left, right }
}

/**
 * A table's top edge, held below the page's own chrome while the table passes under
 * it, so a tall table keeps its tools in reach until its last row has scrolled by.
 */
function tableTop(view: EditorView, pos: number): Rect | null {
  const dom = view.nodeDOM(pos)
  if (!(dom instanceof Element)) return null
  const { top: edge, left, right, bottom } = dom.getBoundingClientRect()
  const chrome =
    Number.parseFloat(getComputedStyle(view.dom).getPropertyValue('--sticky-chrome-top')) || 0
  const top = Math.min(Math.max(edge, chrome + TOOLBAR_ROOM), bottom)
  return { top, bottom: top, left, right }
}

export interface FormattingToolbarProps {
  readonly editor: Editor
  readonly linkEditing: LinkEditing
  /** The box a card's own title and description are typed into (ADR-042). */
  readonly detailsEditing: LinkEditing
  readonly onComment?: ((request: CommentRequest) => void) | undefined
}

export function FormattingToolbar({
  editor,
  linkEditing,
  detailsEditing,
  onComment,
}: FormattingToolbarProps) {
  const state = useEditorSnapshot(editor)
  const target = editor.isEditable ? toolbarTarget(state) : null
  // The surface exists only while there is something to point at, so everything
  // it remembers — whether it is being pressed, whether focus is in it — is
  // forgotten the moment there is not.
  return target === null ? null : (
    <ToolbarSurface
      editor={editor}
      state={state}
      target={target}
      linkEditing={linkEditing}
      detailsEditing={detailsEditing}
      onComment={onComment}
    />
  )
}

interface ToolbarSurfaceProps extends FormattingToolbarProps {
  readonly state: EditorState
  readonly target: ToolbarTarget
}

function ToolbarSurface({
  editor,
  state,
  target,
  linkEditing,
  detailsEditing,
  onComment,
}: ToolbarSurfaceProps) {
  const focused = useEditorFocus(editor)
  const run = useRunAction(editor)
  const toolbar = useRef<HTMLDivElement | null>(null)
  const focusWithin = useFocusWithin(toolbar)
  const [pressed, setPressed] = useState(false)

  const key = targetKey(target)
  const visible = focused || focusWithin || pressed

  // Read from the target of the render it was made in, which is the document the
  // browser has drawn; `useFloatingPlacement` calls it again on every scroll.
  const locate = useCallback(() => locateTarget(editor, target), [editor, target])
  useFloatingPlacement(toolbar, visible, locate, {
    prefer: 'above',
    // A range of text is centred on; a callout's tools hang from its leading edge.
    align: target.kind === 'text' || target.kind === 'link' ? 'center' : 'start',
    // A table's grips and "+" straddle its edge; its tools clear them.
    gap: target.kind === 'table' ? 16 : 8,
  })

  const link = useMemo(
    () =>
      linkActions({
        edit: () => {
          linkEditing.open()
        },
      }),
    [linkEditing],
  )
  const details = useMemo(
    () =>
      cardDetailsAction({
        openDetails: () => {
          detailsEditing.open()
        },
      }),
    [detailsEditing],
  )
  const comment = useMemo(() => commentAction(onComment), [onComment])

  // Alt+F10 enters the toolbar and Mod-K opens the link box. Both are keys
  // pressed in the document, which React does not render, so they are listened
  // for on it directly.
  useEffect(() => {
    const dom = editor.view.dom
    const onKeyDown = (event: KeyboardEvent): void => {
      const modifier = (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey
      if (event.altKey && event.key === 'F10') {
        focusToolbar(toolbar.current)
        event.preventDefault()
      } else if (modifier && event.key.toLowerCase() === 'k') {
        if (linkEditing.open()) event.preventDefault()
      }
    }
    dom.addEventListener('keydown', onKeyDown)
    return () => {
      dom.removeEventListener('keydown', onKeyDown)
    }
  }, [editor, linkEditing])

  const editingLink =
    visible && linkEditing.isOpenFor(key) && (target.kind === 'text' || target.kind === 'link')
  const heldFrom = target.kind === 'text' || target.kind === 'link' ? target.from : 0
  const heldTo = target.kind === 'text' || target.kind === 'link' ? target.to : 0

  // While the link box has the keyboard the browser stops drawing the selection,
  // which is the words the link is for; they are drawn as selected until it is done.
  // Synchronises the editor's decorations, which React does not render, with the box.
  useEffect(() => {
    if (!editingLink) return undefined
    const { view } = editor
    view.dispatch(holdSelectionMeta(view.state.tr, { from: heldFrom, to: heldTo }))
    return () => {
      view.dispatch(releaseSelectionMeta(view.state.tr))
    }
  }, [editor, editingLink, heldFrom, heldTo])

  const editingDetails = visible && detailsEditing.isOpenFor(key) && target.kind === 'link'

  if (!visible) return null

  const finishLink = (command: Command): void => {
    command(editor.state, editor.view.dispatch)
    linkEditing.close()
    editor.view.focus()
  }
  // The address first, then how the link is shown, as one edit: one undo takes both back. A link
  // written as a directive has no address to change here.
  const applyAddressAndDisplay = (href: string, display: LinkDisplayChoice): void => {
    const keepsAddress = target.kind === 'link' && target.form !== 'mark'
    finishLink(inOneStep(...(keepsAddress ? [] : [applyLink(href)]), showLinkAs(display)))
  }
  const returnToDocument = (): void => {
    linkEditing.close()
    detailsEditing.close()
    editor.view.focus()
  }

  return (
    <div
      ref={toolbar}
      role="toolbar"
      // Not in the tab order: Alt+F10 moves focus here, and Escape moves it back.
      tabIndex={-1}
      aria-label={LABELS[target.kind]}
      aria-orientation="horizontal"
      className={toolbarStyles().root()}
      onPointerDown={() => {
        setPressed(true)
        document.addEventListener(
          'pointerup',
          () => {
            setPressed(false)
          },
          { once: true },
        )
      }}
      onKeyDown={(event) => {
        if (handleToolbarKey(event, returnToDocument)) event.preventDefault()
      }}
    >
      {editingDetails ? (
        <DetailsBox
          editor={editor}
          onDone={() => {
            detailsEditing.close()
            editor.view.focus()
          }}
        />
      ) : editingLink ? (
        <LinkEditor
          href={target.kind === 'link' ? target.href : null}
          display={target.kind === 'link' ? displayChoice(target.display) : 'url'}
          blockFits={blockDisplayFits(state)}
          addressLocked={target.kind === 'link' && target.form !== 'mark'}
          onApply={applyAddressAndDisplay}
          onRemove={() => {
            finishLink(unlink)
          }}
          onCancel={returnToDocument}
        />
      ) : (
        <ToolbarFor
          target={target}
          state={state}
          onRun={run}
          link={link}
          details={details}
          comment={comment}
        />
      )}
    </div>
  )
}

/** The display the link box starts from: an embed, which is drawn as a card until embeds exist, reads as one. */
function displayChoice(display: LinkTarget['display']): LinkDisplayChoice {
  return LINK_DISPLAY_CHOICES.find((choice) => choice.display === display)?.display ?? 'card'
}

interface ToolbarForProps {
  readonly target: ToolbarTarget
  readonly state: EditorState
  readonly onRun: (action: EditorAction) => void
  readonly link: ReturnType<typeof linkActions>
  readonly details: EditorAction
  readonly comment: EditorAction | undefined
}

/** The contents for one kind of target. */
function ToolbarFor({ target, state, onRun, link, details, comment }: ToolbarForProps) {
  switch (target.kind) {
    case 'text':
      return <TextToolbarContent state={state} onRun={onRun} link={link.edit} comment={comment} />
    case 'link':
      return (
        <LinkToolbarContent
          state={state}
          onRun={onRun}
          href={target.href}
          details={details}
          form={target.form}
          display={target.display}
          edit={link.edit}
          remove={link.remove}
        />
      )
    case 'table':
      return <TableToolbarContent scope={target.scope} state={state} onRun={onRun} />
    case 'callout':
      return <CalloutToolbarContent state={state} onRun={onRun} callout={target.callout} />
  }
}

interface DetailsBoxProps {
  readonly editor: Editor
  readonly onDone: () => void
}

/** The card's own title and description, with what the page says shown as the placeholders. */
function DetailsBox({ editor, onDone }: DetailsBoxProps) {
  const target = linkTargetAt(editor.state)
  const fetched = useLinkPreviewSource().preview(target?.href ?? '')
  if (target === null || target.form === 'mark') return null
  const { title, description } = target.link.choice
  const apply = (choice: { title: string | null; description: string | null }): void => {
    setLinkChoice(choice)(editor.state, editor.view.dispatch)
    onDone()
  }
  return (
    <LinkDetailsEditor
      current={{ title, description }}
      fetched={fetched}
      onApply={apply}
      onReset={() => {
        apply({ title: null, description: null })
      }}
      onCancel={onDone}
    />
  )
}
