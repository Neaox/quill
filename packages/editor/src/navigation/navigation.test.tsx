import { parseDocument, serializeDocument } from '@quill/markdown'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { history, undo } from '@tiptap/pm/history'
import { EditorState, NodeSelection, TextSelection } from '@tiptap/pm/state'
import type { Command } from '@tiptap/pm/state'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { documentFromMdast, documentToMdast } from '../document/ast.ts'
import { DocumentEditor } from '../document/document-editor.tsx'
import type { DocumentEditorHandle } from '../document/document-editor.tsx'
import { editorSchema } from '../schema/editor-schema.ts'
import { createSlashRegistry } from '../slash/slash-registry.ts'
import { runSlashItem } from '../slash/slash-run.ts'
import { expectNoAccessibilityViolations } from '../testing/axe.ts'
import {
  childPagesOf,
  insertNavigationBlock,
  navigationBlockOf,
  setNavigationBlock,
  tableOfContentsOf,
} from './navigation-commands.ts'
import { editorHeadings } from './navigation-outline.ts'
import type { ChildPagesPreview } from './navigation-view.ts'
import { EditorView } from '@tiptap/pm/view'

/* --- The Markdown a command writes ---------------------------------------- */

function written(state: EditorState): string {
  return serializeDocument({ frontMatter: {}, ast: documentToMdast(state.doc).tree })
}

function stateOf(markdown: string): EditorState {
  return EditorState.create({
    schema: editorSchema,
    doc: documentFromMdast(parseDocument(markdown).ast).doc,
    plugins: [history()],
  })
}

/** The caret at the end of the line reading `text`. */
function caretAt(state: EditorState, text: string): EditorState {
  let found = -1
  state.doc.descendants((node, pos) => {
    if (found === -1 && node.isTextblock && node.textContent === text) {
      found = pos + 1 + node.content.size
    }
    return found === -1
  })
  if (found === -1) throw new Error(`No line reads "${text}".`)
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, found)))
}

function run(state: EditorState, command: Command): EditorState {
  let next = state
  if (!command(state, (tr) => (next = state.apply(tr)))) throw new Error('did not apply')
  return next
}

function blockAt(state: EditorState): number {
  let at = -1
  state.doc.descendants((node, pos) => {
    if (at === -1 && navigationBlockOf(node) !== undefined) at = pos
    return at === -1
  })
  return at
}

describe('the navigation block commands', () => {
  it('inserts a table of contents in place of an empty line, the caret on a new line after it', () => {
    const state = run(caretAt(stateOf('# Title\n\n\n'), 'Title'), insertNavigationBlock('toc'))
    // The fresh line after it is empty, so all that is written of it is a blank line.
    expect(written(state).trimEnd()).toBe('# Title\n\n::toc')
    expect(state.selection.$from.parent.type.name).toBe('paragraph')
  })

  it('inserts after a line with words on it, and one undo takes it back', () => {
    const before = caretAt(stateOf('Intro\n'), 'Intro')
    const state = run(before, insertNavigationBlock('children'))
    expect(written(state).trimEnd()).toBe('Intro\n\n::children')
    expect(written(run(state, undo))).toBe('Intro\n')
  })

  it('writes the settings back as one change, keeping attributes it does not own', () => {
    const state = stateOf('::toc{future=kept}\n')
    const pos = blockAt(state)
    const node = state.doc.nodeAt(pos)
    if (node === null) throw new Error('no block')
    const changed = run(
      state,
      setNavigationBlock(pos, {
        ...tableOfContentsOf(node),
        title: 'On this page',
        levels: { from: 2, to: 4 },
        style: 'numbered',
      }),
    )
    expect(written(changed)).toBe(
      '::toc[On this page]{future="kept" levels="2-4" style="numbered"}\n',
    )
    expect(written(run(changed, undo))).toBe('::toc{future=kept}\n')
  })

  it('can be asked whether it would insert, without inserting', () => {
    const state = caretAt(stateOf('Words\n'), 'Words')
    expect(insertNavigationBlock('toc')(state)).toBe(true)
  })

  it('reads attributes written with no value, and a node holding none', () => {
    const block = editorSchema.nodes['leafDirective']
    if (block === undefined) throw new Error('no leaf directive')
    expect(
      tableOfContentsOf(block.create({ name: 'toc', attributes: { collapsed: null } })),
    ).toMatchObject({
      collapsed: true,
    })
    expect(childPagesOf(block.create({ name: 'children', attributes: null }))).toMatchObject({
      depth: 1,
    })
  })

  it('reads a child pages block, and refuses what is not a navigation block', () => {
    const state = stateOf('::children[Guides]{depth=2 sort=title}\n\n::status\n')
    const node = state.doc.firstChild
    if (node === null) throw new Error('no block')
    expect(childPagesOf(node)).toMatchObject({ title: 'Guides', depth: 2, sort: 'title' })
    const status = state.doc.lastChild
    expect(status === null ? undefined : navigationBlockOf(status)).toBeUndefined()
    const unchanged = setNavigationBlock(state.doc.firstChild?.nodeSize ?? 0, childPagesOf(node))
    expect(unchanged(state)).toBe(false)
    expect(setNavigationBlock(state.doc.content.size, childPagesOf(node))(state)).toBe(false)
    // Writing back what is already there changes nothing, and is no undo step.
    expect(setNavigationBlock(0, childPagesOf(node))(state)).toBe(false)
  })

  it('goes nowhere it cannot: a list item must open with its line', () => {
    const list = stateOf('-\n')
    let line = -1
    list.doc.descendants((node, pos) => {
      if (line === -1 && node.type.name === 'paragraph') line = pos + 1
      return line === -1
    })
    const state = list.apply(list.tr.setSelection(TextSelection.create(list.doc, line)))
    expect(insertNavigationBlock('toc')(state)).toBe(false)
    // A whole block selected is not a line to insert on.
    const atTop = stateOf('Words\n')
    const selected = atTop.apply(atTop.tr.setSelection(NodeSelection.create(atTop.doc, 0)))
    expect(insertNavigationBlock('toc')(selected)).toBe(false)
  })
})

describe('the headings a table of contents lists', () => {
  it('takes the reader’s ids, repeated headings numbered, presenter notes left out', () => {
    const { headings, contents } = editorHeadings(
      stateOf('::toc\n\n## Setup\n\n## Setup\n\n:::notes\n## Spoken\n:::\n\n### Use it\n').doc,
    )
    expect(headings.map(({ id, depth }) => [id, depth])).toEqual([
      ['user-content-setup', 2],
      ['user-content-setup-1', 2],
      ['user-content-use-it', 3],
    ])
    expect(contents).toHaveLength(1)
  })
})

describe('the slash menu', () => {
  const registry = createSlashRegistry()

  it.each([
    ['table-of-contents', '::toc\n'],
    ['child-pages', '::children\n'],
  ])('%s writes %j, and it reads back unchanged', (id, markdown) => {
    const item = registry.findSlashItem(id)
    if (item === undefined) throw new Error(`no item ${id}`)
    const start = stateOf('/q\n')
    const state = start.apply(start.tr.setSelection(TextSelection.create(start.doc, 3)))
    const view = new EditorView(document.createElement('div'), { state })
    runSlashItem({
      view,
      range: { from: 1, to: 3 },
      item,
      request: () => undefined,
      pick: () => undefined,
    })
    expect(`${written(view.state).trimEnd()}\n`).toBe(markdown)
    expect(serializeDocument(parseDocument(markdown))).toBe(markdown)
    view.destroy()
  })

  it('finds them by the names Confluence gives them', () => {
    expect(registry.findSlashItem('table-of-contents')?.aliases).toContain('toc')
    expect(registry.findSlashItem('child-pages')?.aliases).toContain('children')
  })
})

/* --- In the editor ---------------------------------------------------------- */

function mount(source: string, childPages?: ChildPagesPreview) {
  const ref = createRef<DocumentEditorHandle>()
  const result = render(
    <DocumentEditor
      ast={parseDocument(source).ast}
      ref={ref}
      {...(childPages === undefined ? {} : { childPages })}
    />,
  )
  const editor = ref.current?.editor
  if (editor == null) throw new Error('The editor did not mount.')
  return { ref, editor, user: userEvent.setup(), ...result }
}

function markdownOf(ref: { current: DocumentEditorHandle | null }): string {
  const tree = ref.current?.toMdast()
  if (tree === undefined) throw new Error('no editor')
  return serializeDocument({ frontMatter: {}, ast: tree })
}

const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)))

describe('a table of contents in the editor', () => {
  it('previews the headings it will list, as the reader draws them, and is accessible', async () => {
    const { container } = mount('# Guide\n\n::toc\n\n## Install\n\n### Linux\n\n## Use\n')
    const nav = await screen.findByRole('navigation', { name: 'Table of contents' })
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Install', 'Linux', 'Use'])
    expect(within(nav).getByRole('link', { name: 'Linux' }).getAttribute('href')).toBe(
      '#user-content-linux',
    )
    await expectNoAccessibilityViolations(container)
  })

  it('updates as a heading is written', async () => {
    const { editor } = mount('::toc\n\n## Before\n')
    act(() => {
      editor.commands.insertContentAt(editor.state.doc.content.size, '<h2>After</h2>')
    })
    const nav = await screen.findByRole('navigation', { name: 'Table of contents' })
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Before', 'After'])
  })

  it('takes the caret to a heading when one of its entries is pressed', async () => {
    const { editor, user } = mount('::toc\n\n## Install\n\nWords.\n')
    await user.click(await screen.findByRole('link', { name: 'Install' }))
    expect(editor.state.selection.$from.parent.textContent).toBe('Install')
  })

  it('changes its levels, numbering, folding and title from its settings, each one undoable', async () => {
    const { ref, editor, user } = mount('::toc\n\n## A\n\n### B\n\n#### C\n')
    await user.click(screen.getByRole('button', { name: 'Table of contents settings' }))
    const panel = await screen.findByRole('dialog', { name: 'Table of contents settings' })
    // Hung from the Settings button at the block's end, it opens back over the block.
    expect(panel).toHaveAttribute('data-align', 'end')

    await user.selectOptions(within(panel).getByLabelText('To'), 'Heading 4')
    expect(markdownOf(ref)).toContain('::toc{levels="2-4"}')
    // A range chosen backwards is written lowest first.
    await user.selectOptions(within(panel).getByLabelText('From'), 'Heading 6')
    expect(markdownOf(ref)).toContain('::toc{levels="4-6"}')
    await user.selectOptions(within(panel).getByLabelText('From'), 'Heading 2')
    expect(markdownOf(ref)).toContain('::toc{levels="2-6"}')

    await user.click(within(panel).getByLabelText('Numbered'))
    await user.click(within(panel).getByLabelText('Fold subsections'))
    const title = within(panel).getByLabelText('Title')
    await user.type(title, 'On this page{Enter}')
    expect(markdownOf(ref)).toContain(
      '::toc[On this page]{levels="2-6" style="numbered" collapsed}',
    )
    expect(screen.getByRole('navigation', { name: 'On this page' })).toBeDefined()

    act(() => {
      undo(editor.state, editor.view.dispatch)
    })
    expect(markdownOf(ref)).toContain('::toc{levels="2-6" style="numbered" collapsed}')

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Table of contents settings' }),
    )
  })

  it('is selected whole, never typed into', async () => {
    const { editor, user } = mount('Intro\n\n::toc\n\n## A\n')
    await user.click(screen.getByRole('group', { name: 'Table of contents block' }))
    expect(editor.state.selection).toBeInstanceOf(NodeSelection)
    // A caret that lands inside it, as an arrow key can put one, selects it instead.
    act(() => {
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 8)))
    })
    expect(editor.state.selection).toBeInstanceOf(NodeSelection)
    expect(screen.getByRole('group', { name: 'Table of contents block' }).dataset['selected']).toBe(
      'true',
    )
  })

  it('selects itself, not a link, when its title is pressed', async () => {
    const { editor, user } = mount('::toc[Contents]\n\n## A\n')
    await user.click(await screen.findByText('Contents'))
    expect(editor.state.selection).toBeInstanceOf(NodeSelection)
  })

  it('becomes the other block when its name is changed under it', async () => {
    const { editor } = mount('::toc\n\n## A\n')
    await screen.findByRole('group', { name: 'Table of contents block' })
    act(() => {
      editor.view.dispatch(editor.state.tr.setNodeAttribute(0, 'name', 'children'))
    })
    expect(await screen.findByRole('group', { name: 'Child pages block' })).toBeDefined()
  })

  it('lists the headings of a document that had no table of contents until one was put in', async () => {
    const { editor } = mount('Intro\n\n## Install\n')
    act(() => {
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 6)))
      insertNavigationBlock('toc')(editor.state, editor.view.dispatch)
    })
    const nav = await screen.findByRole('navigation', { name: 'Table of contents' })
    expect(within(nav).getByRole('link', { name: 'Install' })).toBeDefined()
  })

  it('lists headings in a child pages block renamed into a table of contents', async () => {
    const { editor } = mount('::children\n\n## Install\n')
    act(() => {
      editor.view.dispatch(editor.state.tr.setNodeAttribute(0, 'name', 'toc'))
    })
    const nav = await screen.findByRole('navigation', { name: 'Table of contents' })
    expect(within(nav).getByRole('link', { name: 'Install' })).toBeDefined()
    // Any other change to its attributes is not a table of contents arriving.
    act(() => {
      editor.view.dispatch(editor.state.tr.setNodeAttribute(0, 'attributes', { levels: '2' }))
    })
    expect(screen.getByRole('link', { name: 'Install' })).toBeDefined()
  })

  it('says so when there is nothing to list', async () => {
    mount('::toc{levels=5}\n\n## Only two\n')
    expect(await screen.findByText('No level 5 headings yet.')).toBeDefined()
  })
})

describe('a child pages block in the editor', () => {
  it('previews the application’s list, asking again when its settings change', async () => {
    const childPages = vi.fn<ChildPagesPreview>(async (query) => ({
      html: `<ul class="child-pages-list"><li class="child-page"><a class="child-page-link" href="/d/a"><span class="child-page-title">Depth ${String(query.depth)}</span></a></li></ul>`,
      count: 1,
    }))
    const { ref, user, container } = mount('::children\n', childPages)
    expect(await screen.findByText('Depth 1')).toBeDefined()

    await user.click(screen.getByRole('button', { name: 'Child pages settings' }))
    const panel = await screen.findByRole('dialog', { name: 'Child pages settings' })
    await user.selectOptions(within(panel).getByLabelText('Levels deep'), '3')
    await user.selectOptions(within(panel).getByLabelText('Order'), 'Recently updated')
    await user.click(within(panel).getByLabelText('Show summaries'))
    await user.click(within(panel).getByLabelText('Show icons'))
    await user.type(within(panel).getByLabelText('Title'), 'Guides{Enter}')
    expect(markdownOf(ref)).toBe('::children[Guides]{depth="3" sort="updated" excerpts icons}\n')
    expect(await screen.findByText('Depth 3')).toBeDefined()
    expect(childPages).toHaveBeenLastCalledWith(
      { title: 'Guides', depth: 3, sort: 'updated', excerpts: true, icons: true },
      expect.any(AbortSignal),
    )
    // A link in the preview does not navigate away from the editor.
    await user.click(screen.getByRole('link', { name: 'Depth 3' }))
    await user.keyboard('{Escape}')
    await expectNoAccessibilityViolations(container)
  })

  it('lists nothing once the application stops offering child pages', async () => {
    const childPages = vi.fn<ChildPagesPreview>(async () => ({
      html: '<ul class="child-pages-list"><li class="child-page">Listed</li></ul>',
      count: 1,
    }))
    const source = '::children' + String.fromCharCode(10)
    const { ref, user, rerender, container } = mount(source, childPages)
    expect(await screen.findByText('Listed')).toBeDefined()
    const asked = childPages.mock.calls.length
    rerender(<DocumentEditor ast={parseDocument(source).ast} ref={ref} />)

    await user.click(screen.getByRole('button', { name: 'Child pages settings' }))
    const panel = await screen.findByRole('dialog', { name: 'Child pages settings' })
    await user.selectOptions(within(panel).getByLabelText('Levels deep'), '2')

    expect(markdownOf(ref)).toBe('::children{depth="2"}' + String.fromCharCode(10))
    // Asked again with nobody to answer, it has nothing to list, and says nothing.
    await waitFor(() => {
      expect(container.querySelector('.child-pages-fallback')).toBeNull()
    })
    expect(container.querySelector('.child-pages')?.textContent).toBe('')
    expect(childPages).toHaveBeenCalledTimes(asked)
  })

  it('says in words what it will list when there is no list to show', async () => {
    mount('::children[Guides]{depth=2 sort=title}\n')
    expect(
      await screen.findByText(
        'The pages under this one, 2 levels deep, by title, are listed here.',
      ),
    ).toBeDefined()
    expect(screen.getByText('Guides')).toBeDefined()
  })

  it('loses its title when the field is emptied, and changes nothing when left as it was', async () => {
    const { ref, user } = mount('::children[Guides]\n')
    await user.click(screen.getByRole('button', { name: 'Child pages settings' }))
    const panel = await screen.findByRole('dialog', { name: 'Child pages settings' })
    const title = within(panel).getByLabelText('Title')
    await user.click(title)
    await user.tab()
    expect(markdownOf(ref)).toBe('::children[Guides]\n')
    await user.clear(title)
    await user.tab()
    expect(markdownOf(ref)).toBe('::children\n')
  })

  it('keeps its words when the list cannot be loaded', async () => {
    mount('::children\n', async () => {
      throw new Error('offline')
    })
    await settle()
    expect(
      screen.getByText(
        'The pages under this one, one level deep, in the navigation’s order, are listed here.',
      ),
    ).toBeDefined()
  })

  it('leaves any other leaf directive drawn as it was', () => {
    const { container } = mount('::status{service=api}\n')
    expect(container.querySelector('div.leaf-directive')).not.toBeNull()
    expect(screen.queryByRole('group', { name: /block$/ })).toBeNull()
  })
})
