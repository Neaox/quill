import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { expectNoAccessibilityViolations } from '@quill/ui/testing/axe'

import { createHookWrapper } from '../../lib/api/hook-wrapper.tsx'
import { errorResponse, jsonResponse } from '../../lib/api/testing.ts'
import { RenameDocumentControl } from './rename-document-control.tsx'

function renamedDocument(title: string) {
  return jsonResponse(200, {
    id: 'doc-1',
    workspaceId: 'workspace-1',
    collectionId: 'col-1',
    parentId: null,
    slug: 'notes',
    path: 'guides/notes.md',
    title,
    status: 'draft',
    templateId: null,
    templateVersion: null,
    headRevision: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  })
}

const NOOP = () => {}

/** A `PATCH` handler whose response only resolves once the test says so, to observe the pending state. */
function deferredPatch() {
  let resolve: (title: string) => void = NOOP
  const bodies: Array<Record<string, unknown>> = []
  const handler = (request: Request) =>
    new Promise<Response>((res) => {
      resolve = async (title) => {
        bodies.push((await request.json()) as Record<string, unknown>)
        res(renamedDocument(title))
      }
    })
  return { handler, resolve: (title: string) => resolve(title), bodies }
}

describe('RenameDocumentControl', () => {
  it('shows the title as a labelled button, not editing', () => {
    render(<RenameDocumentControl documentId="doc-1" title="Quarterly plan" />, {
      wrapper: createHookWrapper(),
    })

    expect(screen.getByRole('button', { name: 'Rename "Quarterly plan"' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('opens the field on click, with the current title and focus in it', async () => {
    render(<RenameDocumentControl documentId="doc-1" title="Quarterly plan" />, {
      wrapper: createHookWrapper(),
    })

    await userEvent.click(screen.getByRole('button', { name: 'Rename "Quarterly plan"' }))

    const field = screen.getByRole('textbox', { name: 'Document title' })
    expect(field).toHaveValue('Quarterly plan')
    expect(field).toHaveFocus()
  })

  it('opens the field on F2', async () => {
    render(<RenameDocumentControl documentId="doc-1" title="Quarterly plan" />, {
      wrapper: createHookWrapper(),
    })

    screen.getByRole('button', { name: 'Rename "Quarterly plan"' }).focus()
    await userEvent.keyboard('{F2}')

    expect(screen.getByRole('textbox', { name: 'Document title' })).toBeInTheDocument()
  })

  it('saves on Enter, showing the loading state until the server answers', async () => {
    const deferred = deferredPatch()
    render(<RenameDocumentControl documentId="doc-1" title="Quarterly plan" />, {
      wrapper: createHookWrapper({ 'PATCH /api/documents/{id}': deferred.handler }),
    })

    await userEvent.click(screen.getByRole('button', { name: 'Rename "Quarterly plan"' }))
    await userEvent.clear(screen.getByRole('textbox', { name: 'Document title' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Document title' }), 'Annual plan')
    await userEvent.keyboard('{Enter}')

    const save = screen.getByRole('button', { name: 'Save' })
    await waitFor(() => {
      expect(save).toHaveAttribute('aria-busy', 'true')
    })

    deferred.resolve('Annual plan')
    // The new title reaching the button is the parent's job (its query cache
    // is what `title` comes from); this unit only owns leaving edit mode once
    // the save resolves.
    await waitFor(() => {
      expect(screen.queryByRole('textbox', { name: 'Document title' })).not.toBeInTheDocument()
    })
    expect(deferred.bodies).toEqual([{ title: 'Annual plan' }])
  })

  it('cancels on Escape without saving', async () => {
    const bodies: unknown[] = []
    render(<RenameDocumentControl documentId="doc-1" title="Quarterly plan" />, {
      wrapper: createHookWrapper({
        'PATCH /api/documents/{id}': async (request) => {
          bodies.push(await request.json())
          return renamedDocument('should not happen')
        },
      }),
    })

    await userEvent.click(screen.getByRole('button', { name: 'Rename "Quarterly plan"' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Document title' }), ' extra')
    await userEvent.keyboard('{Escape}')

    expect(screen.getByRole('button', { name: 'Rename "Quarterly plan"' })).toBeInTheDocument()
    expect(bodies).toEqual([])
  })

  it('saves on blur', async () => {
    const bodies: unknown[] = []
    render(<RenameDocumentControl documentId="doc-1" title="Quarterly plan" />, {
      wrapper: createHookWrapper({
        'PATCH /api/documents/{id}': async (request) => {
          bodies.push(await request.json())
          return renamedDocument('Annual plan')
        },
      }),
    })

    await userEvent.click(screen.getByRole('button', { name: 'Rename "Quarterly plan"' }))
    await userEvent.clear(screen.getByRole('textbox', { name: 'Document title' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Document title' }), 'Annual plan')
    // Tabbing away blurs the field without clicking a control of its own —
    // exactly the "moved on to something else" case `onBlur` has to cover.
    await userEvent.tab()

    await waitFor(() => {
      expect(bodies).toEqual([{ title: 'Annual plan' }])
    })
  })

  it('does not save an unchanged or blank title', async () => {
    const bodies: unknown[] = []
    render(<RenameDocumentControl documentId="doc-1" title="Quarterly plan" />, {
      wrapper: createHookWrapper({
        'PATCH /api/documents/{id}': async (request) => {
          bodies.push(await request.json())
          return renamedDocument('should not happen')
        },
      }),
    })

    await userEvent.click(screen.getByRole('button', { name: 'Rename "Quarterly plan"' }))
    await userEvent.keyboard('{Enter}')

    expect(bodies).toEqual([])
    expect(screen.getByRole('button', { name: 'Rename "Quarterly plan"' })).toBeInTheDocument()
  })

  it('shows the server error inline and stays in edit mode', async () => {
    render(<RenameDocumentControl documentId="doc-1" title="Quarterly plan" />, {
      wrapper: createHookWrapper({
        'PATCH /api/documents/{id}': () =>
          errorResponse(422, 'path_unavailable', 'That title is already taken here'),
      }),
    })

    await userEvent.click(screen.getByRole('button', { name: 'Rename "Quarterly plan"' }))
    await userEvent.clear(screen.getByRole('textbox', { name: 'Document title' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Document title' }), 'Annual plan')
    await userEvent.keyboard('{Enter}')

    expect(await screen.findByRole('alert')).toHaveTextContent('That title is already taken here')
    expect(screen.getByRole('textbox', { name: 'Document title' })).toBeInTheDocument()
  })

  it('has no axe violations while editing', async () => {
    const { container } = render(
      <RenameDocumentControl documentId="doc-1" title="Quarterly plan" />,
      { wrapper: createHookWrapper() },
    )

    await userEvent.click(screen.getByRole('button', { name: 'Rename "Quarterly plan"' }))
    await expectNoAccessibilityViolations(container)
  })
})
