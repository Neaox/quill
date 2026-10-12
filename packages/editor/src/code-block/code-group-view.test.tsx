import { parseDocument, serializeDocument } from '@quill/markdown'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { redo, undo } from '@tiptap/pm/history'
import { createRef } from 'react'
import { describe, expect, it } from 'vitest'

import { DocumentEditor } from '../document/document-editor.tsx'
import type { DocumentEditorHandle } from '../document/document-editor.tsx'
import { expectNoAccessibilityViolations } from '../testing/axe.ts'
import { EditorView as CodeMirrorView } from '@codemirror/view'
import { EditorView as ProseMirrorView } from '@tiptap/pm/view'

import { createEditorTestHarness } from '../testing/harness.ts'
import { CodeGroupNodeView, TAB_HELP } from './code-group-view.ts'

const fence = (lang: string, meta: string, value: string): string =>
  ['```' + lang + (meta === '' ? '' : ` ${meta}`), value, '```'].join('\n')

const GROUP = [
  'Before.',
  '',
  ':::code-group',
  fence('ts', '[TypeScript]', 'await fetch(url)'),
  fence('py', '[Python]', 'requests.get(url)'),
  fence('sh', '[curl]', 'curl $URL'),
  ':::',
  '',
  'After.',
  '',
].join('\n')

function open(source = GROUP) {
  const ref = createRef<DocumentEditorHandle>()
  const result = render(<DocumentEditor ast={parseDocument(source).ast} ref={ref} />)
  return { ref, user: userEvent.setup(), ...result }
}

function markdown(ref: { current: DocumentEditorHandle | null }): string {
  const handle = ref.current
  if (handle === null) throw new Error('The editor did not expose a handle.')
  return serializeDocument({ frontMatter: {}, ast: handle.toMdast() })
}

function editorOf(ref: { current: DocumentEditorHandle | null }) {
  const editor = ref.current?.editor
  if (editor === undefined || editor === null) throw new Error('There is no editor.')
  return editor
}

function tabs(): HTMLElement[] {
  return within(screen.getByRole('tablist', { name: 'Code group tabs' })).getAllByRole('tab')
}

function names(): string[] {
  return tabs().map((tab) => tab.textContent)
}

function chosen(): string | null | undefined {
  return tabs().find((tab) => tab.getAttribute('aria-selected') === 'true')?.textContent
}

/** The panels, as the group shows them: the code block of each tab. */
function panels(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.code-group-panels > *')]
}

function tabNamed(name: string): HTMLElement {
  const found = tabs().find((each) => each.textContent === name)
  if (found === undefined) throw new Error(`There is no "${name}" tab.`)
  return found
}

describe('a code group in the editor', () => {
  it('shows its tabs, the first chosen, and only that tab’s code', () => {
    open()
    expect(screen.getByRole('group', { name: 'Code group' })).toBeVisible()
    expect(names()).toEqual(['TypeScript', 'Python', 'curl'])
    expect(chosen()).toBe('TypeScript')
    expect(panels().map((panel) => panel.hidden)).toEqual([false, true, true])
    expect(tabs()[0]).toHaveAttribute('aria-controls', panels()[0]?.id)
    expect(screen.getByRole('tablist', { name: 'Code group tabs' })).toHaveAccessibleDescription(
      TAB_HELP,
    )
  })

  it('makes each panel a tab panel named by its tab', () => {
    open()
    expect(panels().map((panel) => panel.getAttribute('role'))).toEqual([
      'tabpanel',
      'tabpanel',
      'tabpanel',
    ])
    expect(screen.getByRole('tabpanel', { name: 'TypeScript' })).toBe(panels()[0])
    expect(panels()[1]).toHaveAttribute('aria-labelledby', tabs()[1]?.id)
  })

  it('keeps the tab around its rename field, so the strip holds only tabs', async () => {
    const { user } = open()
    await user.dblClick(tabNamed('Python'))
    const field = screen.getByRole('textbox', { name: 'Tab name' })
    const strip = screen.getByRole('tablist', { name: 'Code group tabs' })

    expect([...strip.children].map((child) => child.getAttribute('role'))).toEqual([
      'tab',
      'tab',
      'tab',
    ])
    expect(field.closest('[role="tab"]')).toHaveAttribute('aria-selected', 'true')
    expect(panels()[1]).toHaveAttribute('aria-labelledby', field.closest('[role="tab"]')?.id)
  })

  it('writes the document back byte for byte, in each syntax it reads', () => {
    for (const source of [
      GROUP,
      GROUP.replace(':::code-group', '::: code-group'),
      GROUP.replace(':::code-group', ':::code-group{sync=pkg}'),
      [fence('ts', 'tab="TypeScript"', 'a'), '', fence('py', 'tab="Python"', 'b'), ''].join('\n'),
    ]) {
      const { ref, unmount } = open(source)
      expect(markdown(ref)).toBe(source)
      unmount()
    }
  })

  it('chooses a tab by pointer without changing the document or moving the caret', async () => {
    const { ref, user } = open()
    const before = markdown(ref)
    const selection = editorOf(ref).state.selection.from

    await user.click(tabNamed('Python'))

    expect(chosen()).toBe('Python')
    expect(tabNamed('Python')).toHaveFocus()
    expect(panels().map((panel) => panel.hidden)).toEqual([true, false, true])
    expect(markdown(ref)).toBe(before)
    expect(editorOf(ref).state.selection.from).toBe(selection)
  })

  it('moves between tabs by arrow keys, Home and End, with one tab stop', async () => {
    const { user } = open()
    await user.click(tabNamed('TypeScript'))

    await user.keyboard('{ArrowRight}')
    expect(chosen()).toBe('Python')
    await user.keyboard('{End}')
    expect(chosen()).toBe('curl')
    await user.keyboard('{ArrowRight}')
    expect(chosen()).toBe('TypeScript')
    await user.keyboard('{ArrowLeft}')
    expect(chosen()).toBe('curl')
    await user.keyboard('{Home}')
    expect(chosen()).toBe('TypeScript')
    expect(tabs().map((each) => each.tabIndex)).toEqual([0, -1, -1])
    expect(tabNamed('TypeScript')).toHaveFocus()
  })

  it('takes the keyboard into the code on Enter', async () => {
    const { user } = open()
    await user.click(tabNamed('Python'))
    await user.keyboard('{Enter}')
    await waitFor(() => {
      expect(document.activeElement?.closest('.cm-editor')).not.toBeNull()
    })
    expect(panels()[1]?.contains(document.activeElement)).toBe(true)
  })

  it('adds a tab with the caret in it, and undo takes it away again', async () => {
    const { ref, user } = open()
    await user.click(screen.getByRole('button', { name: 'Add tab' }))

    expect(names()).toEqual(['TypeScript', 'Python', 'curl', 'Code 4'])
    expect(chosen()).toBe('Code 4')
    await waitFor(() => {
      expect(panels()[3]?.contains(document.activeElement)).toBe(true)
    })
    expect(markdown(ref)).toContain('```sh [curl]\ncurl $URL\n```\n```\n```\n:::')

    act(() => {
      undo(editorOf(ref).state, editorOf(ref).view.dispatch)
    })
    expect(names()).toEqual(['TypeScript', 'Python', 'curl'])
    expect(markdown(ref)).toBe(GROUP)
  })

  it('renames a tab in place by double click, and keeps the name in the fence', async () => {
    const { ref, user } = open()
    await user.dblClick(tabNamed('TypeScript'))
    const field = screen.getByRole('textbox', { name: 'Tab name' })
    expect(field).toHaveFocus()
    await user.clear(field)
    await user.type(field, 'Node.js{Enter}')

    expect(names()).toEqual(['Node.js', 'Python', 'curl'])
    expect(tabNamed('Node.js')).toHaveFocus()
    expect(markdown(ref)).toContain('```ts [Node.js]\n')

    act(() => {
      undo(editorOf(ref).state, editorOf(ref).view.dispatch)
    })
    expect(markdown(ref)).toBe(GROUP)
  })

  it('renames by F2, puts the name back on Escape, and hands an emptied name to the language', async () => {
    const { ref, user } = open()
    await user.click(tabNamed('Python'))
    await user.keyboard('{F2}')
    await user.keyboard('{Control>}a{/Control}Snake{Escape}')
    expect(names()).toEqual(['TypeScript', 'Python', 'curl'])
    expect(markdown(ref)).toBe(GROUP)

    await user.keyboard('{F2}')
    await user.clear(screen.getByRole('textbox', { name: 'Tab name' }))
    await user.keyboard('{Enter}')
    expect(markdown(ref)).toContain('```py\nrequests.get(url)')
    expect(names()).toEqual(['TypeScript', 'Python', 'curl'])
  })

  it('keeps a name that is unchanged, or left by moving away', async () => {
    const { ref, user } = open()
    await user.dblClick(tabNamed('curl'))
    await user.keyboard('{Enter}')
    expect(markdown(ref)).toBe(GROUP)

    await user.dblClick(tabNamed('curl'))
    await user.type(screen.getByRole('textbox', { name: 'Tab name' }), ' (Unix)')
    await user.click(screen.getByText('Before.'))
    expect(markdown(ref)).toContain('```sh [curl (Unix)]')
  })

  it('removes a tab by Delete or by its cross, and the group with its last', async () => {
    const { ref, user } = open()
    await user.click(tabNamed('Python'))
    await user.keyboard('{Delete}')
    expect(names()).toEqual(['TypeScript', 'curl'])
    expect(chosen()).toBe('curl')
    expect(tabNamed('curl')).toHaveFocus()

    const cross = tabNamed('curl').querySelector('[data-action="remove"]')
    if (cross === null) throw new Error('The tab has no cross.')
    await user.click(cross)
    expect(names()).toEqual(['TypeScript'])

    await user.keyboard('{Backspace}')
    expect(screen.queryByRole('tablist', { name: 'Code group tabs' })).toBeNull()
    expect(markdown(ref)).toBe('Before.\n\nAfter.\n')

    act(() => {
      undo(editorOf(ref).state, editorOf(ref).view.dispatch)
    })
    expect(names()).toEqual(['TypeScript'])
  })

  it('reorders by Alt and an arrow key, and by dragging', async () => {
    const { ref, user } = open()
    await user.click(tabNamed('TypeScript'))
    await user.keyboard('{Alt>}{ArrowRight}{/Alt}')
    expect(names()).toEqual(['Python', 'TypeScript', 'curl'])
    expect(tabNamed('TypeScript')).toHaveFocus()
    await user.keyboard('{Alt>}{ArrowLeft}{ArrowLeft}{/Alt}')
    expect(names()).toEqual(['TypeScript', 'Python', 'curl'])
    expect(markdown(ref)).toBe(GROUP)

    const store = new Map<string, string>()
    const dataTransfer = {
      setData: (type: string, value: string) => store.set(type, value),
      getData: (type: string) => store.get(type) ?? '',
      effectAllowed: 'none',
      dropEffect: 'none',
    }
    fireEvent.dragStart(tabNamed('curl'), { dataTransfer })
    expect(tabNamed('curl')).toHaveAttribute('data-dragging')
    fireEvent.dragOver(tabNamed('TypeScript'), { dataTransfer })
    expect(tabNamed('TypeScript')).toHaveAttribute('data-drop', 'before')
    fireEvent.drop(tabNamed('TypeScript'), { dataTransfer })
    expect(names()).toEqual(['curl', 'TypeScript', 'Python'])
    expect(tabNamed('curl')).not.toHaveAttribute('data-dragging')

    fireEvent.dragStart(tabNamed('curl'), { dataTransfer })
    fireEvent.dragOver(tabNamed('Python'), { dataTransfer })
    expect(tabNamed('Python')).toHaveAttribute('data-drop', 'after')
    fireEvent.dragEnd(tabNamed('curl'), { dataTransfer })
    expect(tabNamed('Python')).not.toHaveAttribute('data-drop')

    act(() => {
      undo(editorOf(ref).state, editorOf(ref).view.dispatch)
    })
    expect(names()).toEqual(['TypeScript', 'Python', 'curl'])
    act(() => {
      redo(editorOf(ref).state, editorOf(ref).view.dispatch)
    })
    expect(names()).toEqual(['curl', 'TypeScript', 'Python'])
  })

  it('shows the tab the selection is put in, and not one it merely rests in', () => {
    const { ref } = open()
    const editor = editorOf(ref)
    let python = 0
    editor.state.doc.descendants((node, pos) => {
      if (node.textContent === 'requests.get(url)' && node.type.name === 'codeBlock') python = pos
    })
    act(() => {
      editor.commands.setTextSelection(python + 2)
    })
    expect(chosen()).toBe('Python')
  })

  it('leaves the group, not for the next tab, on Escape', () => {
    const { ref } = open()
    const editor = editorOf(ref)
    const content = panels()[0]?.querySelector('.cm-content')
    if (content === null || content === undefined) throw new Error('No code editor.')
    act(() => {
      content.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(editor.state.selection.$from.parent.textContent).toBe('After.')
    expect(chosen()).toBe('TypeScript')
  })

  it('keeps a Fumadocs group a Fumadocs group', async () => {
    const source = [fence('ts', 'tab="A"', 'a'), '', fence('py', 'tab="B"', 'b'), ''].join('\n')
    const { ref, user } = open(source)
    await user.click(screen.getByRole('button', { name: 'Add tab' }))
    expect(markdown(ref)).toContain('```py tab="B"\nb\n```\n\n```text tab="Code 3"\n```')

    await user.dblClick(tabNamed('A'))
    await user.clear(screen.getByRole('textbox', { name: 'Tab name' }))
    await user.keyboard('{Enter}')
    expect(names()[0]).toBe('A')
  })

  it('has no accessibility violations', async () => {
    const { container } = open()
    await expectNoAccessibilityViolations(container)
  })
})

describe('the edges of working a group', () => {
  it('commits a name once, however the field is left', async () => {
    const { ref, user } = open()
    await user.dblClick(tabNamed('Python'))
    const field = screen.getByRole('textbox', { name: 'Tab name' })
    await user.type(field, '3{Enter}')
    fireEvent.blur(field)
    expect(markdown(ref)).toContain('```py [Python3]')
  })

  it('ignores a drop on the tab being dragged, and a drag it did not start', () => {
    const { ref } = open()
    const dataTransfer = { setData: () => undefined, getData: () => '', effectAllowed: 'none' }
    fireEvent.dragOver(tabNamed('Python'), { dataTransfer })
    expect(tabNamed('Python')).not.toHaveAttribute('data-drop')
    fireEvent.drop(tabNamed('Python'), { dataTransfer })

    fireEvent.dragStart(tabNamed('Python'), { dataTransfer })
    fireEvent.dragOver(tabNamed('Python'), { dataTransfer })
    expect(tabNamed('Python')).not.toHaveAttribute('data-drop')
    const strip = screen.getByRole('tablist', { name: 'Code group tabs' })
    fireEvent.dragOver(strip, { dataTransfer })
    fireEvent.drop(tabNamed('Python'), { dataTransfer })
    fireEvent.dragStart(tabNamed('Python'))
    fireEvent.drop(strip)
    fireEvent.click(strip)
    fireEvent.doubleClick(strip)
    fireEvent.keyDown(strip, { key: 'ArrowRight' })
    expect(markdown(ref)).toBe(GROUP)
    expect(chosen()).toBe('TypeScript')
  })

  it('keeps a key it has no use for, and an Alt arrow off the end, to itself', async () => {
    const { ref, user } = open()
    await user.click(tabNamed('TypeScript'))
    await user.keyboard('{Alt>}{ArrowLeft}{/Alt}')
    await user.keyboard('x')
    expect(names()).toEqual(['TypeScript', 'Python', 'curl'])
    expect(markdown(ref)).toBe(GROUP)
  })
})

describe('the code group node view itself', () => {
  function mount() {
    const state = createEditorTestHarness().state(GROUP)
    const host = document.createElement('div')
    document.body.append(host)
    const view = new ProseMirrorView(host, { state })
    const group = view.state.doc.child(1)
    return { view, group, nodeView: new CodeGroupNodeView(group, view, () => undefined) }
  }

  it('does nothing once it has been taken out of the document', () => {
    const { nodeView, view } = mount()
    const before = view.state.doc
    within(nodeView.dom).getByRole('button', { name: 'Add tab' }).click()
    // No code editor is drawn here, so there is nothing to copy, and copying says so.
    within(nodeView.dom).getByRole('button', { name: 'Copy TypeScript code' }).click()
    expect(view.state.doc).toBe(before)
    nodeView.destroy()
    view.destroy()
  })

  it('refuses to become another node, and owns its strip but not its panels', () => {
    const { nodeView, view } = mount()
    expect(nodeView.update(view.state.doc.child(0))).toBe(false)
    const strip = within(nodeView.dom).getByRole('tablist')
    expect(nodeView.ignoreMutation({ type: 'selection', target: strip })).toBe(false)
    expect(
      nodeView.ignoreMutation({ type: 'attributes', target: strip } as unknown as MutationRecord),
    ).toBe(true)
    expect(
      nodeView.ignoreMutation({
        type: 'childList',
        target: nodeView.contentDOM,
      } as unknown as MutationRecord),
    ).toBe(false)
    const inStrip = new Event('mousedown', { bubbles: true })
    strip.dispatchEvent(inStrip)
    expect(nodeView.stopEvent(inStrip)).toBe(true)
    view.destroy()
  })
})

describe('the tab on show', () => {
  it('starts its code right under the tabs, with no caption of its own', () => {
    open()
    for (const panel of panels()) {
      expect(panel.querySelector('figcaption')).toBeNull()
      expect(panel.querySelector('.code-block-toolbar')).not.toBeVisible()
      expect(panel.querySelector('.code-block-editor')?.className).toContain(
        '[&_.cm-content]:py-3.5',
      )
    }
    expect(screen.getAllByRole('combobox', { name: 'Code block language' })).toHaveLength(1)
  })

  it('takes its language from the strip, as one undoable step', async () => {
    const { ref, user } = open()
    await user.click(tabNamed('curl'))
    const field = screen.getByRole('combobox', { name: 'Code block language' })
    expect(field).toHaveValue('Bash')
    await user.clear(field)
    await user.type(field, 'PowerShell{Enter}')
    expect(markdown(ref)).toContain('```PowerShell [curl]')
    expect(field).toHaveFocus()

    act(() => {
      undo(editorOf(ref).state, editorOf(ref).view.dispatch)
    })
    expect(markdown(ref)).toBe(GROUP)

    await user.clear(field)
    await user.type(field, 'Go{Escape}')
    expect(field).toHaveValue('Bash')
    await waitFor(() => {
      expect(panels()[2]?.contains(document.activeElement)).toBe(true)
    })
  })

  it('names an unlabelled tab by the language the strip gives it', async () => {
    const source = ['Before.', '', ':::code-group', '```', 'a', '```', ':::', ''].join('\n')
    const { user } = open(source)
    expect(names()).toEqual(['Code 1'])
    const field = screen.getByRole('combobox', { name: 'Code block language' })
    await user.type(field, 'Rust{Enter}')
    expect(names()).toEqual(['Rust'])
  })

  it('copies the tab on show, or the selection in it', async () => {
    const { user } = open()
    await user.click(tabNamed('Python'))
    const written: string[] = []
    const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          written.push(text)
        },
      },
    })
    const copy = screen.getByRole('button', { name: 'Copy Python code' })
    fireEvent.click(copy)
    await waitFor(() => {
      expect(written).toEqual(['requests.get(url)'])
    })

    // "Copied" has its moment before the button offers itself again.
    await waitFor(
      () => {
        expect(copy).toHaveAttribute('data-state', 'idle')
      },
      { timeout: 3000 },
    )
    const host = panels()[1]?.querySelector<HTMLElement>('.cm-editor')
    const code = host === null || host === undefined ? null : CodeMirrorView.findFromDOM(host)
    act(() => {
      code?.dispatch({ selection: { anchor: 0, head: 8 } })
    })
    expect(copy).toHaveAttribute('data-mode', 'selection')
    fireEvent.click(copy)
    await waitFor(() => {
      expect(written).toEqual(['requests.get(url)', 'requests'])
    })
    act(() => {
      code?.dispatch({ selection: { anchor: 0 } })
    })
    expect(copy).toHaveAttribute('data-mode', 'code')
    if (original === undefined) Reflect.deleteProperty(navigator, 'clipboard')
    else Object.defineProperty(navigator, 'clipboard', original)
  })
})
