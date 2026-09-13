import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import { expectNoAccessibilityViolations } from '@quill/ui/testing/axe'

import { createHookWrapper } from '../../lib/api/hook-wrapper.tsx'
import { errorResponse, jsonResponse, type FakeRoutes } from '../../lib/api/testing.ts'
import { MoveDocumentDialog, type MoveDocumentDialogProps } from './move-document-dialog.tsx'

/**
 * `col-guides` has a two-level document tree: `parent` sits at the top and
 * `child` is nested under it, so a move into either can be told apart from a
 * move to the collection's top level, and the currently-open document
 * (`doc-1`) has its own nested child (`doc-1-child`) to exercise the
 * self-descendant guard.
 */
const WORKSPACE_TREE = () =>
  jsonResponse(200, {
    collections: [
      {
        id: 'col-guides',
        name: 'Guides',
        slug: 'guides',
        documents: [
          { id: 'parent', title: 'Parent doc', slug: 'parent', status: 'published', children: [] },
          {
            id: 'doc-1',
            title: 'Quarterly plan',
            slug: 'quarterly-plan',
            status: 'draft',
            children: [
              {
                id: 'doc-1-child',
                title: 'Quarterly plan detail',
                slug: 'detail',
                status: 'draft',
                children: [],
              },
            ],
          },
        ],
      },
      {
        id: 'col-archive',
        name: 'Archive',
        slug: 'archive',
        documents: [],
      },
    ],
  })

function movedDocument(overrides: Record<string, unknown> = {}) {
  return jsonResponse(200, {
    id: 'doc-1',
    workspaceId: 'workspace-1',
    collectionId: 'col-guides',
    parentId: null,
    slug: 'quarterly-plan',
    path: 'guides/quarterly-plan.md',
    title: 'Quarterly plan',
    status: 'draft',
    templateId: null,
    templateVersion: null,
    headRevision: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  })
}

function Harness(props: Omit<MoveDocumentDialogProps, 'open' | 'onOpenChange'>) {
  const [open, setOpen] = useState(true)
  return <MoveDocumentDialog {...props} open={open} onOpenChange={setOpen} />
}

function renderDialog(
  props: Partial<Omit<MoveDocumentDialogProps, 'open' | 'onOpenChange'>> = {},
  routes: FakeRoutes = {},
) {
  return render(
    <Harness
      workspaceId="workspace-1"
      documentId="doc-1"
      documentTitle="Quarterly plan"
      currentCollectionId="col-guides"
      currentParentId={null}
      {...props}
    />,
    { wrapper: createHookWrapper({ 'GET /api/workspaces/{id}/tree': WORKSPACE_TREE, ...routes }) },
  )
}

describe('MoveDocumentDialog', () => {
  it('shows the workspace’s collections and documents as a destination tree', async () => {
    renderDialog()

    const dialog = await screen.findByRole('dialog', { name: 'Move to…' })
    expect(await within(dialog).findByRole('button', { name: 'Parent doc' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /Top level of Guides/ })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Top level of Archive' })).toBeInTheDocument()
    expect(
      within(dialog).getByRole('button', { name: /Quarterly plan detail/ }),
    ).toBeInTheDocument()
  })

  it('marks the current location', async () => {
    renderDialog({ currentCollectionId: 'col-guides', currentParentId: 'parent' })

    const target = await screen.findByRole('button', { name: /Parent doc/ })
    expect(within(target).getByText('current location')).toBeInTheDocument()
  })

  it('disallows moving the document into its own subtree, or into itself', async () => {
    renderDialog()

    const descendant = await screen.findByRole('button', { name: /Quarterly plan detail/ })
    expect(descendant).toBeDisabled()
    expect(within(descendant).getByText('Would move the document into itself')).toBeInTheDocument()

    const self = screen.getByRole('button', { name: /^Quarterly plan(?! detail)/ })
    expect(self).toBeDisabled()

    // A destination unrelated to the document being moved stays enabled.
    expect(screen.getByRole('button', { name: 'Parent doc' })).toBeEnabled()
  })

  it('enables Move only once a destination is chosen, and confirms with the loading state', async () => {
    const bodies: Array<Record<string, unknown>> = []
    renderDialog(
      {},
      {
        'PATCH /api/documents/{id}': async (request) => {
          bodies.push((await request.json()) as Record<string, unknown>)
          return movedDocument({ parentId: 'parent' })
        },
      },
    )

    const moveButton = await screen.findByRole('button', { name: 'Move' })
    expect(moveButton).toBeDisabled()

    await userEvent.click(await screen.findByRole('button', { name: 'Parent doc' }))
    expect(moveButton).toBeEnabled()

    await userEvent.click(moveButton)

    await waitFor(() => {
      expect(bodies).toEqual([{ collectionId: 'col-guides', parentId: 'parent' }])
    })
  })

  it('sends a null parentId when the destination is a collection’s top level', async () => {
    const bodies: Array<Record<string, unknown>> = []
    renderDialog(
      {},
      {
        'PATCH /api/documents/{id}': async (request) => {
          bodies.push((await request.json()) as Record<string, unknown>)
          return movedDocument({ collectionId: 'col-archive' })
        },
      },
    )

    const archiveTopLevel = await screen.findByRole('button', { name: 'Top level of Archive' })
    await userEvent.click(archiveTopLevel)
    await userEvent.click(screen.getByRole('button', { name: 'Move' }))

    await waitFor(() => {
      expect(bodies).toEqual([{ collectionId: 'col-archive', parentId: null }])
    })
  })

  it('shows the server’s 403/422 message inline and keeps the dialog open', async () => {
    renderDialog(
      {},
      {
        'PATCH /api/documents/{id}': () =>
          errorResponse(403, 'forbidden', 'You do not have manage access to Archive'),
      },
    )

    await userEvent.click(await screen.findByRole('button', { name: 'Parent doc' }))
    await userEvent.click(screen.getByRole('button', { name: 'Move' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You do not have manage access to Archive',
    )
    expect(screen.getByRole('dialog', { name: 'Move to…' })).toBeInTheDocument()
  })

  it('closes without moving anything when Cancel is clicked', async () => {
    renderDialog()
    await screen.findByRole('dialog', { name: 'Move to…' })

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  it('has no axe violations', async () => {
    const { container } = renderDialog()
    await screen.findByRole('dialog', { name: 'Move to…' })

    await expectNoAccessibilityViolations(container)
  })
})
