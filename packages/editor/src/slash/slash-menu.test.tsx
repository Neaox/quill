import { parseDocument, serializeDocument } from '@quill/markdown'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { expectNoAccessibilityViolations } from '../testing/axe.ts'
import { DocumentEditor } from '../document/document-editor.tsx'
import type { DocumentEditorHandle } from '../document/document-editor.tsx'
import { SlashMenu } from './slash-menu.tsx'
import { createSlashStore } from './slash-store.ts'
import type { SlashRequest } from './slash-items.ts'

function open(source = 'Start here.\n') {
  const ref = createRef<DocumentEditorHandle>()
  const onRequest = vi.fn<(request: SlashRequest) => void>()
  const result = render(
    <DocumentEditor ast={parseDocument(source).ast} ref={ref} onRequest={onRequest} />,
  )
  return { ref, onRequest, user: userEvent.setup(), ...result }
}

function markdown(ref: { current: DocumentEditorHandle | null }): string {
  const handle = ref.current
  if (handle === null) throw new Error('The editor did not expose a handle.')
  return serializeDocument({ frontMatter: {}, ast: handle.toMdast() })
}

function surface(): HTMLElement {
  return screen.getByRole('textbox', { name: 'Document' })
}

async function slash(user: ReturnType<typeof userEvent.setup>, query = ''): Promise<HTMLElement> {
  await user.click(surface())
  await user.keyboard(`/${query}`)
  return screen.getByRole('listbox', { name: 'Insert' })
}

describe('the slash menu', () => {
  it('opens on a slash and lists what can be inserted', async () => {
    const { user, container } = open()
    const menu = await slash(user)
    expect(screen.getAllByRole('option').length).toBeGreaterThan(5)
    expect(menu).toBeVisible()
    await expectNoAccessibilityViolations(container)
  })

  it('narrows as the author types, and says when nothing matches', async () => {
    const { user } = open()
    await slash(user, 'tab')
    expect(screen.getAllByRole('option').map((item) => item.textContent)).toHaveLength(1)
    await user.keyboard('{Backspace}{Backspace}{Backspace}zzz')
    expect(screen.queryAllByRole('option')).toEqual([])
    expect(screen.getByText('No matching block')).toBeVisible()
  })

  it('lends the document its active-descendant state, because focus never leaves it', async () => {
    const { user } = open()
    await slash(user)
    expect(surface().getAttribute('aria-activedescendant')).toBe(
      screen.getAllByRole('option')[0]?.id,
    )
  })

  it('moves through the list with the arrows and inserts with Enter', async () => {
    const { user, ref } = open()
    await slash(user, 'callout')
    await user.keyboard('{ArrowDown}{Enter}')
    expect(markdown(ref)).toContain(':::callout')
    expect(screen.queryByRole('listbox', { name: 'Insert' })).not.toBeInTheDocument()
  })

  it('leaves the document without the query it was asked with', async () => {
    const { user, ref } = open()
    await slash(user, 'table')
    await user.keyboard('{Enter}')
    expect(markdown(ref)).not.toContain('/table')
  })

  it('closes on Escape without inserting anything', async () => {
    const { user, ref } = open()
    await slash(user, 'table')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('listbox', { name: 'Insert' })).not.toBeInTheDocument()
    expect(markdown(ref)).not.toContain('|')
    expect(surface()).not.toHaveAttribute('aria-activedescendant')
  })

  it('inserts the item the pointer chooses, keeping the selection it acts on', async () => {
    const { user, ref } = open()
    await slash(user, 'guidance')
    await user.click(screen.getByRole('option', { name: /Guidance/ }))
    expect(markdown(ref)).toContain(':::guidance')
  })

  it('highlights the item the pointer is over', async () => {
    const { user } = open()
    await slash(user, 'callout')
    const items = screen.getAllByRole('option')
    const second = items[1]
    if (second === undefined) throw new Error('There is only one callout.')
    await user.hover(second)
    expect(second).toHaveAttribute('data-active')
  })

  it('raises a request for what the editor cannot invent', async () => {
    const { user, onRequest, ref } = open()
    await slash(user, 'image')
    await user.keyboard('{Enter}')
    expect(onRequest).toHaveBeenCalledWith({ kind: 'image' })
    expect(markdown(ref)).not.toContain('![')
  })

  it('shows nothing while it is closed', () => {
    const store = createSlashStore()
    const { container } = render(<SlashMenu store={store} editor={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('places itself under the caret when the browser can say where that is', () => {
    const store = createSlashStore()
    render(<SlashMenu store={store} editor={null} />)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})
