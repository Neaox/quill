import { parseDocument, serializeDocument } from '@quill/markdown'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { expectNoAccessibilityViolations } from '../testing/axe.ts'
import { DocumentEditor } from './document-editor.tsx'
import type { DocumentEditorHandle } from './document-editor.tsx'

const SOURCE = [
  '# Authentication architecture',
  '',
  'Every request carries a short-lived access token.',
  '',
  ':::wide',
  '| Endpoint | Purpose |',
  '| - | - |',
  '| /auth/token | Exchange credentials |',
  ':::',
  '',
  '```ts',
  "const token = 'abc'",
  '```',
  '',
  ':::guidance',
  'Keep the context short.',
  ':::',
  '',
  ':::optional{title="Alternatives considered"}',
  'What else was possible.',
  ':::',
  '',
].join('\n')

function open(source: string = SOURCE) {
  const ref = createRef<DocumentEditorHandle>()
  const onChange = vi.fn<(handle: DocumentEditorHandle) => void>()
  const result = render(
    <DocumentEditor ast={parseDocument(source).ast} ref={ref} onChange={onChange} />,
  )
  return { ref, onChange, ...result }
}

function markdown(handle: DocumentEditorHandle | null): string {
  if (handle === null) throw new Error('The editor did not expose a handle.')
  return serializeDocument({ frontMatter: {}, ast: handle.toMdast() })
}

describe('the document editor', () => {
  it('renders the document as an editable region with an accessible name', () => {
    open()
    const region = screen.getByRole('textbox', { name: 'Document' })
    expect(region).toHaveAttribute('aria-multiline', 'true')
    expect(region).toHaveAttribute('contenteditable', 'true')
  })

  it('renders every block of the document', () => {
    open()
    expect(screen.getByRole('heading', { name: 'Authentication architecture' })).toBeVisible()
    expect(screen.getByRole('table')).toBeVisible()
    expect(screen.getByRole('note', { name: 'Guidance' })).toBeVisible()
  })

  it('renders the whole document without an accessibility violation', async () => {
    const { container } = open()
    await expectNoAccessibilityViolations(container)
  })

  it('gives back the document it was given', () => {
    const { ref } = open()
    expect(markdown(ref.current)).toBe(serializeDocument(parseDocument(SOURCE)))
  })

  it('shows a block at its width rather than as a wrapper', () => {
    open()
    expect(screen.getByRole('table')).toHaveAttribute('data-layout', 'wide')
  })

  it('hosts the code block in a code editor with a language picker', () => {
    open()
    const picker = screen.getByRole('combobox', { name: 'Code block language' })
    expect(picker).toHaveValue('typescript')
  })

  it('reports a change as soon as one is made', async () => {
    const user = userEvent.setup()
    const { onChange, ref } = open('Hello\n')
    await user.click(screen.getByRole('textbox', { name: 'Document' }))
    await user.keyboard('!')
    expect(onChange).toHaveBeenCalled()
    expect(markdown(ref.current)).toContain('!')
  })

  it('does not reopen the document when a later AST arrives', () => {
    const { rerender, ref } = open('One\n')
    rerender(<DocumentEditor ast={parseDocument('Two\n').ast} ref={ref} />)
    expect(markdown(ref.current)).toBe('One\n')
  })
})
