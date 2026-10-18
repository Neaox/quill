import { PlusIcon, buttonClassName, cx } from '@quill/ui'
import type { Command } from '@tiptap/pm/state'
import { Selection, TextSelection } from '@tiptap/pm/state'
import { useEditorState } from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import { useLayoutEffect, useRef } from 'react'
import { tv } from 'tailwind-variants'

import { topLevelBlock } from '../block/commands.ts'
import { pageLayoutFrame } from '../document/measuring.ts'
import { nodeType } from '../schema/node-type.ts'

/**
 * The "+" in the gutter beside the block the caret is in, as Notion and
 * Confluence have: the slash menu for a writer who has not met the slash.
 *
 * It does exactly what typing `/` does, on a fresh line — the line the caret
 * is on when that line is empty, a new one after the block otherwise — so
 * there is one menu, opened two ways, and everything that holds for the
 * slash (keys, undo, Escape) holds here. It is a real button, reachable with
 * Tab, and it keeps the document's selection when clicked.
 */

const inserter = tv({
  slots: {
    root: 'block-inserter absolute z-10 max-sm:hidden',
    button: 'size-6 p-0 text-muted hover:text-foreground',
  },
})

const styles = inserter()

/** Opens the insert menu on an empty line at the caret's block (see the module note). */
export const openInsertMenu: Command = (state, dispatch) => {
  const block = topLevelBlock(state)
  if (block === null) return false
  if (dispatch === undefined) return true
  const { node, pos } = block
  const emptyLine = node.type.name === 'paragraph' && node.content.size === 0
  const tr = state.tr
  if (emptyLine) {
    tr.setSelection(TextSelection.create(tr.doc, pos + 1))
  } else {
    const after = pos + node.nodeSize
    tr.insert(after, nodeType(state.schema, 'paragraph').create())
    tr.setSelection(TextSelection.create(tr.doc, after + 1))
  }
  dispatch(tr.insertText('/').scrollIntoView())
  return true
}

/** How far the button's leading edge sits before the block's: its width and a small gap. */
const GUTTER = 34
/** The button's own height, `size-6`, so it can be centred on the first line. */
const BUTTON = 27

export interface GutterPosition {
  readonly top: number
  readonly left: number
}

/**
 * Beside the caret's block, relative to the editor's frame, or null where
 * there is no laid-out block to be beside.
 */
export function gutterPosition(editor: Editor): GutterPosition | null {
  const block = topLevelBlock(editor.state)
  if (block === null) return null
  const dom = editor.view.nodeDOM(block.pos)
  const frame = editor.view.dom.closest('.document-editor')
  if (!(dom instanceof HTMLElement) || frame === null) return null
  const box = dom.getBoundingClientRect()
  const origin = frame.getBoundingClientRect()
  // Centred on the block's first line, so it sits level with a heading's
  // words as well as a paragraph's.
  const line = editor.view.coordsAtPos(Selection.near(editor.state.doc.resolve(block.pos + 1)).from)
  const middle = (line.top + line.bottom) / 2
  return {
    top: Math.max(box.top, middle - BUTTON / 2) - origin.top,
    // It may sit a little outside the editor's frame: the reading grid's
    // gutter is narrower than a button on a laptop, and the page has room.
    left: box.left - origin.left - GUTTER,
  }
}

export interface BlockInserterProps {
  readonly editor: Editor | null
}

export function BlockInserter({ editor }: BlockInserterProps) {
  // Which block the caret is in, which changes when the caret moves to
  // another block but not as the author types inside one.
  const block = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      if (current === null) return undefined
      const pos = topLevelBlock(current.state)?.pos
      // The frame is there only once the document is mounted, which is the
      // first moment there is anything to measure.
      const mounted = current.view.dom.closest('.document-editor') !== null
      return pos === undefined ? undefined : `${String(pos)}:${String(mounted)}`
    },
  })
  const root = useRef<HTMLDivElement | null>(null)
  // Measured when the block changes, not on every keystroke, and in the
  // page's layout frame rather than while React renders: reading the layout
  // straight after ProseMirror has written makes the browser lay a long
  // document out again between keys (section 31, `document/measuring.ts`).
  useLayoutEffect(() => {
    const element = root.current
    if (editor === null || block === undefined || element === null) return undefined
    const frame = pageLayoutFrame()
    const owner = {}
    frame.schedule(owner, () => {
      const position = gutterPosition(editor)
      return () => {
        element.hidden = position === null
        if (position === null) return
        element.style.top = `${String(position.top)}px`
        element.style.left = `${String(position.left)}px`
      }
    })
    return () => {
      frame.cancel(owner)
    }
  }, [editor, block])

  if (editor === null || block === undefined) return null

  return (
    <div ref={root} className={styles.root()}>
      <button
        type="button"
        aria-label="Insert a block"
        title="Insert a block"
        className={cx(buttonClassName({ variant: 'ghost', size: 'sm' }), styles.button())}
        onMouseDown={(event) => {
          // The document keeps the selection the menu opens at.
          event.preventDefault()
        }}
        onClick={() => {
          editor.view.focus()
          openInsertMenu(editor.state, editor.view.dispatch)
        }}
      >
        <PlusIcon />
      </button>
    </div>
  )
}
