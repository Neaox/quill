import { parseDocument, serializeDocument } from '@quill/markdown'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { undo } from '@tiptap/pm/history'
import { DOMParser as ProseMirrorParser } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import type { Command, EditorState } from '@tiptap/pm/state'
import { createRef } from 'react'
import { describe, expect, it } from 'vitest'

import { documentToMdast } from '../document/ast.ts'
import { DocumentEditor } from '../document/document-editor.tsx'
import type { DocumentEditorHandle } from '../document/document-editor.tsx'
import { editorSchema } from '../schema/editor-schema.ts'
import { expectNoAccessibilityViolations } from '../testing/axe.ts'
import { createEditorTestHarness } from '../testing/harness.ts'
import {
  backspaceInDetails,
  enterFromSummary,
  exitDetails,
  isOpenByDefault,
  setOpenByDefault,
} from './details-commands.ts'
import { setFolded } from './details-folds.ts'
import { DetailsNodeView } from './details-view.ts'

const harness = createEditorTestHarness()

/* --- Commands, against a state ------------------------------------------- */

function written(state: EditorState): string {
  return serializeDocument({ frontMatter: {}, ast: documentToMdast(state.doc).tree })
}

/** A state with the caret in the textblock holding `text`, at `offset` within it. */
function caretIn(source: string, text: string, offset = 0): EditorState {
  const state = harness.state(source)
  let found = -1
  state.doc.descendants((node, pos) => {
    if (found === -1 && node.isTextblock && node.textContent === text) found = pos + 1 + offset
    return found === -1
  })
  if (found === -1) throw new Error(`No line reads "${text}".`)
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, found)))
}

/** A state with the caret on the empty line of the body of the details at the top. */
function caretInEmptyBody(source: string, index = 1): EditorState {
  const state = harness.state(source)
  const details = state.doc.firstChild
  let pos = 1
  details?.forEach((child, offset, at) => {
    if (at === index) pos = 1 + offset + 1
  })
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)))
}

function run(state: EditorState, command: Command): EditorState {
  let next = state
  const ran = command(state, (tr) => {
    next = state.apply(tr)
  })
  if (!ran) throw new Error('The command did not apply.')
  return next
}

describe('details commands', () => {
  it('goes from the summary into the body on Enter, taking the words after the caret', () => {
    const state = run(
      caretIn(':::details[Summary words]\nBody.\n:::\n', 'Summary words', 7),
      enterFromSummary,
    )
    expect(written(state)).toBe(':::details[Summary]\nwords\n\nBody.\n:::\n')
    expect(state.selection.$from.parent.textContent).toBe('words')
  })

  it('reuses an empty first line of the body, and opens no new one', () => {
    const state = run(caretIn(':::details[Title]\n:::\n', 'Title', 5), enterFromSummary)
    expect(written(state)).toBe(':::details[Title]\n:::\n')
    expect(state.selection.$from.parent.type.name).toBe('paragraph')
  })

  it('takes a details away on Backspace at the start of its summary, keeping its words', () => {
    const state = run(caretIn(':::details[Title]\nBody.\n:::\n', 'Title'), backspaceInDetails)
    expect(written(state)).toBe('Title\n\nBody.\n')
  })

  it('takes a details with an empty body away on Backspace there, the caret after its summary', () => {
    const state = run(caretInEmptyBody(':::details[Title]\n:::\n'), backspaceInDetails)
    expect(written(state)).toBe('Title\n')
    expect(state.selection.from).toBe(6)
  })

  it('goes back to the summary on Backspace at the start of a body with something in it', () => {
    const state = run(caretIn(':::details[Title]\nBody.\n:::\n', 'Body.'), backspaceInDetails)
    expect(written(state)).toBe(':::details[Title]\nBody.\n:::\n')
    expect(state.selection.$from.parent.type.name).toBe('detailsSummary')
    expect(state.selection.$from.parentOffset).toBe(5)
  })

  it('leaves Backspace alone anywhere else', () => {
    expect(backspaceInDetails(caretIn(':::details[Title]\nBody.\n:::\n', 'Body.', 2))).toBe(false)
    expect(backspaceInDetails(caretIn('Plain.\n', 'Plain.'))).toBe(false)
    expect(backspaceInDetails(caretIn(':::details[Title]\nOne.\n\nTwo.\n:::\n', 'Two.'))).toBe(
      false,
    )
  })

  it('leaves the details on Enter on an empty last line, with more above it', () => {
    const state = harness.state(':::details[Title]\nBody.\n:::\n')
    const details = state.doc.firstChild
    if (details === null) throw new Error('No details.')
    const end = details.nodeSize - 1
    const withLine = state.apply(
      state.tr.insert(end, editorSchema.nodes['paragraph']?.create() ?? details),
    )
    const caret = withLine.apply(
      withLine.tr.setSelection(TextSelection.create(withLine.doc, end + 1)),
    )
    const left = run(caret, exitDetails)
    // The new line after it is the empty paragraph the caret is on.
    expect(written(left)).toBe(':::details[Title]\nBody.\n:::\n\n')
    expect(left.selection.$from.depth).toBe(1)
    expect(exitDetails(caretInEmptyBody(':::details[Title]\n:::\n'))).toBe(false)
    expect(enterFromSummary(caretIn('Plain.\n', 'Plain.'))).toBe(false)
  })

  it('makes a details open by default, and keeps its other attributes where they were', () => {
    const state = harness.state(':::details[A]{type=tip name=faq}\nx\n:::\n')
    const opened = run(state, setOpenByDefault(0, true))
    expect(written(opened)).toBe(':::details[A]{type="tip" name="faq" open}\nx\n:::\n')
    expect(written(run(opened, setOpenByDefault(0, false)))).toBe(
      // Back to the attributes it was read with, so back to how they were written.
      ':::details[A]{type=tip name=faq}\nx\n:::\n',
    )
    expect(setOpenByDefault(0, false)(state)).toBe(false)
    expect(setOpenByDefault(5, true)(state)).toBe(false)
    expect(setFolded(5, true)(state)).toBe(false)
  })
})

/* --- The editor, as an author meets it ----------------------------------- */

function open(source: string) {
  localStorage.clear()
  const ref = createRef<DocumentEditorHandle>()
  const result = render(<DocumentEditor ast={parseDocument(source).ast} ref={ref} />)
  return { ref, user: userEvent.setup(), ...result }
}

function editorOf(ref: { current: DocumentEditorHandle | null }) {
  const editor = ref.current?.editor
  if (editor === null || editor === undefined) throw new Error('The editor did not mount.')
  return editor
}

function markdown(ref: { current: DocumentEditorHandle | null }): string {
  const handle = ref.current
  if (handle === null) throw new Error('The editor did not expose a handle.')
  return serializeDocument({ frontMatter: {}, ast: handle.toMdast() })
}

function surface(): HTMLElement {
  return screen.getByRole('textbox', { name: 'Document' })
}

function body(): HTMLElement[] {
  return [
    ...document.querySelectorAll<HTMLElement>('.details-editor-content > :not(.details-summary)'),
  ]
}

const GITHUB =
  '<details>\n<summary>Supported browsers</summary>\n\n- Chrome\n- Firefox\n\n</details>\n'

describe('a details in the editor', () => {
  it('shows its summary line and its body, both editable, and passes axe', async () => {
    const { container } = open(GITHUB)
    const group = screen.getByRole('group', { name: 'Details: Supported browsers' })
    expect(group).toBeVisible()
    expect(group.querySelector('.details-summary')?.textContent).toBe('Supported browsers')
    expect(body()[0]?.tagName).toBe('UL')
    expect(screen.getByRole('button', { name: 'Hide the body while editing' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(screen.getByRole('button', { name: 'Open by default' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    await expectNoAccessibilityViolations(container)
  })

  it('opens and closes while editing without changing the document or its history', async () => {
    const { ref, user } = open(GITHUB)
    const toggle = screen.getByRole('button', { name: 'Hide the body while editing' })

    await user.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('group', { name: /^Details/u })).toHaveAttribute('data-folded')
    expect(markdown(ref)).toBe(GITHUB)
    expect(undo(editorOf(ref).state)).toBe(false)

    await user.click(screen.getByRole('button', { name: 'Show the body while editing' }))
    expect(screen.getByRole('group', { name: /^Details/u })).not.toHaveAttribute('data-folded')
  })

  it('opens again by itself when the caret goes into its body', async () => {
    const { ref, user } = open(GITHUB)
    await user.click(screen.getByRole('button', { name: 'Hide the body while editing' }))

    act(() => {
      editorOf(ref).commands.setTextSelection(30)
    })

    expect(screen.getByRole('group', { name: /^Details/u })).not.toHaveAttribute('data-folded')
  })

  it('sets “Open by default”, which the document keeps and undo takes back', async () => {
    const { ref, user } = open(GITHUB)
    const toggle = screen.getByRole('button', { name: 'Open by default' })

    await user.click(toggle)

    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(markdown(ref)).toBe(GITHUB.replace('<details>', '<details open>'))
    act(() => {
      undo(editorOf(ref).state, editorOf(ref).view.dispatch)
    })
    expect(markdown(ref)).toBe(GITHUB)
  })

  it('writes every syntax back byte for byte when nothing changed', () => {
    for (const source of [
      GITHUB,
      ':::details[Title]{open}\n\nBody.\n\n:::\n',
      '> [!tip]- Hint\n> Body.\n',
      '::::accordion\n:::details[A]\na\n:::\n::::\n',
    ]) {
      const { ref, unmount } = open(source)
      expect(markdown(ref)).toBe(source)
      unmount()
    }
  })

  it('draws a folded callout in its kind’s colours, and an accordion as a group', () => {
    open('> [!warning]- Careful\n> Body.\n\n::::accordion\n:::details[A]\na\n:::\n::::\n')
    expect(screen.getByRole('group', { name: 'Details: Careful' })).toHaveClass(
      'callout',
      'callout-warning',
    )
    expect(screen.getByRole('group', { name: 'Accordion' })).toBeVisible()
  })

  it('hints at the summary while it is empty', () => {
    open(':::details\nBody.\n:::\n')
    expect(screen.getByRole('group', { name: 'Details' })).toHaveAttribute('data-summary-empty')
  })
})

describe('making a details', () => {
  async function slash(source: string, query: string) {
    const opened = open(source)
    await opened.user.click(surface())
    act(() => {
      editorOf(opened.ref).commands.focus('end')
    })
    await opened.user.keyboard(`/${query}`)
    await opened.user.keyboard('{Enter}')
    return opened
  }

  it('comes from the slash menu as “Details”, found by Confluence’s “expand” too', async () => {
    const { ref, user } = await slash('\n', 'expand')
    await user.keyboard('Why?')
    expect(markdown(ref)).toBe(':::details[Why?]\n:::\n')
  })

  it('comes from the slash menu as an accordion of two', async () => {
    const { ref } = await slash('\n', 'accordion')
    expect(markdown(ref)).toBe('::::accordion\n:::details\n:::\n\n:::details\n:::\n::::\n')
    expect(editorOf(ref).state.selection.$from.parent.type.name).toBe('detailsSummary')
  })

  it('comes from typing +++ and a space on an empty line', async () => {
    const { ref, user } = open('\n')
    await user.click(surface())
    await user.keyboard('+++ Summary')
    expect(markdown(ref)).toBe(':::details[Summary]\n:::\n')
  })

  it('reads GitHub’s details out of pasted HTML, open and all', () => {
    const { ref } = open('\n')
    const html = '<details open><summary>Pasted</summary><p>Inside.</p></details>'
    const element = document.createElement('div')
    element.innerHTML = html
    const slice = ProseMirrorParser.fromSchema(editorOf(ref).schema).parseSlice(element)
    act(() => {
      editorOf(ref).view.dispatch(editorOf(ref).state.tr.replaceSelection(slice))
    })
    expect(markdown(ref)).toBe(':::details[Pasted]{open}\nInside.\n:::\n')
    const closed = document.createElement('div')
    closed.innerHTML = '<details><summary>Closed</summary><p>x</p></details>'
    const node = ProseMirrorParser.fromSchema(editorOf(ref).schema).parse(closed).firstChild
    expect(node?.attrs['attributes']).toEqual({})
  })

  it('reads GitHub’s details out of pasted Markdown', () => {
    const { ref } = open('\n')
    act(() => {
      fireEvent.paste(surface(), {
        clipboardData: {
          getData: (type: string) => (type === 'text/plain' ? GITHUB : ''),
          types: ['text/plain'],
        },
      })
    })
    expect(markdown(ref)).toBe(GITHUB)
  })
})

function selecting(state: EditorState, from: number, to: number): EditorState {
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, from, to)))
}

describe('what the details commands and view decline', () => {
  it('reports without acting when asked without a dispatch', () => {
    const state = harness.state(':::details[Title]\nBody.\n\n:::\n')
    expect(enterFromSummary(caretIn(':::details[Title]\nBody.\n:::\n', 'Title', 2))).toBe(true)
    expect(backspaceInDetails(caretIn(':::details[Title]\nBody.\n:::\n', 'Title'))).toBe(true)
    expect(backspaceInDetails(caretIn(':::details[Title]\nBody.\n:::\n', 'Body.'))).toBe(true)
    expect(backspaceInDetails(caretInEmptyBody(':::details[Title]\n:::\n'))).toBe(true)
    expect(setOpenByDefault(0, true)(state)).toBe(true)
    const end = (state.doc.firstChild?.nodeSize ?? 0) - 1
    const grown = state.apply(state.tr.insert(end, editorSchema.nodes['paragraph']?.create() ?? []))
    const onLastLine = grown.apply(grown.tr.setSelection(TextSelection.create(grown.doc, end + 1)))
    expect(onLastLine.selection.$from.parent.content.size).toBe(0)
    expect(exitDetails(onLastLine)).toBe(true)
  })

  it('declines a selection, a line with words, a line elsewhere, and a line that is not last', () => {
    const source = ':::details[Title]\nOne.\n\n- item\n\nTwo.\n:::\n\nAfter.\n'
    expect(enterFromSummary(selecting(caretIn(source, 'Title'), 2, 4))).toBe(false)
    expect(backspaceInDetails(selecting(caretIn(source, 'Title'), 2, 4))).toBe(false)
    expect(backspaceInDetails(caretIn(source, 'After.'))).toBe(false)
    expect(backspaceInDetails(caretIn(source, 'item'))).toBe(false)
    expect(exitDetails(selecting(caretIn(source, 'One.'), 1, 3))).toBe(false)
    expect(exitDetails(caretIn(source, 'Two.'))).toBe(false)
    expect(exitDetails(caretIn(':::details[Title]\n## Heading\n:::\n', 'Heading'))).toBe(false)
    expect(exitDetails(caretIn('\n', ''))).toBe(false)
    const listed = harness.state(':::details[Title]\n- \n\nx\n:::\n')
    let inItem = -1
    listed.doc.descendants((node, pos) => {
      if (inItem === -1 && node.type.name === 'paragraph' && node.content.size === 0)
        inItem = pos + 1
      return inItem === -1
    })
    expect(
      exitDetails(listed.apply(listed.tr.setSelection(TextSelection.create(listed.doc, inItem)))),
    ).toBe(false)
    const middle = harness.state(':::details[Title]\nOne.\n:::\n')
    const details = middle.doc.firstChild
    if (details === null) throw new Error('No details.')
    const withLines = middle.apply(
      middle.tr.insert(details.nodeSize - 1, [
        editorSchema.nodes['paragraph']?.create() ?? details,
        editorSchema.nodes['paragraph']?.create(null, editorSchema.text('Last.')) ?? details,
      ]),
    )
    let empty = -1
    withLines.doc.descendants((node, pos) => {
      if (empty === -1 && node.type.name === 'paragraph' && node.content.size === 0) empty = pos + 1
      return empty === -1
    })
    const onEmpty = withLines.apply(
      withLines.tr.setSelection(TextSelection.create(withLines.doc, empty)),
    )
    expect(onEmpty.selection.$from.index(1)).toBe(2)
    expect(exitDetails(onEmpty)).toBe(false)
  })

  it('reads a details whose attributes are missing as closed', () => {
    const node = editorSchema.nodes['details']?.create({ attributes: null }, [
      editorSchema.nodes['detailsSummary']?.create() ?? editorSchema.text('x'),
      editorSchema.nodes['paragraph']?.create() ?? editorSchema.text('x'),
    ])
    expect(node === undefined ? undefined : isOpenByDefault(node)).toBe(false)
  })
})

describe('the details view, on its own', () => {
  function viewOf(source: string, getPos: () => number | undefined = () => 0) {
    const { ref } = open(source)
    const editor = editorOf(ref)
    const node = editor.state.doc.firstChild
    if (node === null) throw new Error('No details.')
    return { view: new DetailsNodeView(node, editor.view, getPos, []), editor, node }
  }

  it('does nothing once it has left the document', () => {
    const { view, editor } = viewOf(':::details[A]\nx\n:::\n', () => undefined)
    const before = editor.state
    view.dom.querySelector<HTMLButtonElement>('.details-editor-toggle')?.click()
    view.dom.querySelector<HTMLButtonElement>('.details-editor-default')?.click()
    expect(editor.state.doc.eq(before.doc)).toBe(true)
  })

  it('is redrawn for another node only of its own type, and keeps its controls its own', () => {
    const { view } = viewOf(':::details[A]{type=shout}\nx\n:::\n')
    expect(view.dom).toHaveClass('callout', 'callout-note')
    const paragraph = editorSchema.nodes['paragraph']?.create()
    if (paragraph === undefined) throw new Error('No paragraph node.')
    expect(view.update(paragraph, [])).toBe(false)
    const toggle = view.dom.querySelector('.details-editor-toggle')
    expect(view.stopEvent(new MouseEvent('click'))).toBe(false)
    const click = new MouseEvent('click', { bubbles: true })
    toggle?.dispatchEvent(click)
    expect(view.stopEvent(click)).toBe(true)
    const inside = new MouseEvent('click', { bubbles: true })
    view.contentDOM.dispatchEvent(inside)
    expect(view.stopEvent(inside)).toBe(false)
    expect(view.ignoreMutation({ target: view.dom })).toBe(true)
    expect(view.ignoreMutation({ target: view.contentDOM })).toBe(false)
  })
})

describe('typing +++ where a details cannot go', () => {
  it.each([
    ['in a heading', '# \n', 'end'],
    ['before words', 'Words\n', 'start'],
    ['as a list item’s first line', '- \n', 'end'],
  ] as const)('leaves it as typed %s', async (_where, source, position) => {
    const { ref, user } = open(source)
    await user.click(surface())
    act(() => {
      editorOf(ref).commands.focus(position)
    })
    await user.keyboard('+++ ')
    expect(markdown(ref)).not.toContain(':::details')
  })
})
