import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { expectNoAccessibilityViolations } from '@quill/ui/testing/axe'

import { renderApp } from '../../lib/api/render-app.tsx'
import { errorResponse, jsonResponse, type FakeRoutes } from '../../lib/api/testing.ts'

const admin = () =>
  jsonResponse(200, {
    id: 'user-1',
    email: 'admin@example.com',
    displayName: 'Admin',
    emailVerified: true,
    isInstanceAdmin: true,
  })

const unit = (id: string, name: string, parentId: string | null = null) => ({
  id,
  parentId,
  name,
  slug: name.toLowerCase(),
  label: 'unit',
  createdAt: '2026-01-01T00:00:00.000Z',
})

const workspaceRow = (id: string, name: string, unitId: string) => ({
  id,
  unitId,
  name,
  slug: name.toLowerCase(),
  createdAt: '2026-01-01T00:00:00.000Z',
  unit: { id: unitId, name: 'Acme', path: ['Acme'] },
})

/** One root unit with one workspace in it, and no child units. */
function organisation(routes: FakeRoutes = {}): FakeRoutes {
  return {
    'GET /api/me': admin,
    'GET /api/units': (request) => {
      const parentId = new URL(request.url).searchParams.get('parentId')
      return jsonResponse(200, parentId === null ? [unit('unit-1', 'Acme')] : [])
    },
    'GET /api/workspaces': () => jsonResponse(200, [workspaceRow('ws-1', 'Engineering', 'unit-1')]),
    ...routes,
  }
}

describe('the organisation page', () => {
  it('shows the units and the workspaces inside them', async () => {
    renderApp('/admin/organisation', organisation())

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Organisation' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Acme')).toBeInTheDocument()
    // The workspace's own address is its slug (ADR-035), not its id.
    expect(await screen.findByRole('link', { name: 'Engineering' })).toHaveAttribute(
      'href',
      '/w/engineering',
    )
  })

  it('creates a unit under the root', async () => {
    const bodies: Array<Record<string, unknown>> = []
    renderApp(
      '/admin/organisation',
      organisation({
        'POST /api/units': async (request) => {
          bodies.push((await request.json()) as Record<string, unknown>)
          return jsonResponse(201, unit('unit-2', 'Globex'))
        },
      }),
    )

    await userEvent.click(await screen.findByRole('button', { name: 'New unit' }))
    const dialog = await screen.findByRole('dialog', { name: 'New unit' })
    await userEvent.type(within(dialog).getByLabelText('Name', { exact: false }), 'Globex')
    await userEvent.type(
      within(dialog).getByLabelText('What you call this level', { exact: false }),
      'company',
    )
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }))

    await waitFor(() => {
      // `parentId` is omitted, never sent as null: the route's own comment
      // explains why an explicit null would arrive as an empty string.
      expect(bodies).toEqual([{ name: 'Globex', label: 'company' }])
    })
  })

  it('creates a workspace in a unit, with an address suggested from the name', async () => {
    const bodies: Array<Record<string, unknown>> = []
    renderApp(
      '/admin/organisation',
      organisation({
        'POST /api/workspaces': async (request) => {
          bodies.push((await request.json()) as Record<string, unknown>)
          return jsonResponse(201, {
            id: 'ws-2',
            unitId: 'unit-1',
            name: 'Platform docs',
            slug: 'platform-docs',
            createdAt: '2026-01-01T00:00:00.000Z',
          })
        },
      }),
    )

    await userEvent.click(await screen.findByRole('button', { name: 'New workspace' }))
    const dialog = await screen.findByRole('dialog', { name: 'New workspace in Acme' })
    await userEvent.type(within(dialog).getByLabelText('Name', { exact: false }), 'Platform docs')
    expect(within(dialog).getByLabelText('Address', { exact: false })).toHaveValue('platform-docs')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }))

    await waitFor(() => {
      expect(bodies).toEqual([{ unitId: 'unit-1', name: 'Platform docs', slug: 'platform-docs' }])
    })
  })

  it('renames a unit', async () => {
    const names: string[] = []
    renderApp(
      '/admin/organisation',
      organisation({
        'PATCH /api/units/{id}': async (request) => {
          const body = (await request.json()) as { name: string }
          names.push(body.name)
          return jsonResponse(200, unit('unit-1', body.name))
        },
      }),
    )

    await userEvent.click(await screen.findByRole('button', { name: 'More actions for Acme' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Rename…' }))
    const dialog = await screen.findByRole('dialog', { name: /Rename/ })
    const field = within(dialog).getByLabelText('Name', { exact: false })
    await userEvent.clear(field)
    await userEvent.type(field, 'Acme group')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(names).toEqual(['Acme group'])
    })
  })

  it('refuses to delete a unit that still holds a workspace, and says what is in it', async () => {
    renderApp('/admin/organisation', organisation())

    await userEvent.click(await screen.findByRole('button', { name: 'More actions for Acme' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete…' }))

    const dialog = await screen.findByRole('dialog', { name: /Delete/ })
    expect(within(dialog).getByText(/still holds one workspace/)).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
  })

  it('refuses to delete a workspace that still holds documents', async () => {
    renderApp(
      '/admin/organisation',
      organisation({
        'GET /api/workspaces/{workspaceId}/documents': () =>
          jsonResponse(200, [{ id: 'doc-1', title: 'A page' }]),
      }),
    )

    await userEvent.click(
      await screen.findByRole('button', { name: 'More actions for Engineering' }),
    )
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete…' }))

    const dialog = await screen.findByRole('dialog', { name: /Delete/ })
    expect(await within(dialog).findByText(/still holds one document/)).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
  })

  it('deletes an empty workspace', async () => {
    const deleted: string[] = []
    renderApp(
      '/admin/organisation',
      organisation({
        'GET /api/workspaces/{workspaceId}/documents': () => jsonResponse(200, []),
        'DELETE /api/workspaces/{id}': (_request, params) => {
          deleted.push(params['id'] ?? '')
          return new Response(null, { status: 204 })
        },
      }),
    )

    await userEvent.click(
      await screen.findByRole('button', { name: 'More actions for Engineering' }),
    )
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete…' }))

    const dialog = await screen.findByRole('dialog', { name: /Delete/ })
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(deleted).toEqual(['ws-1'])
    })
  })

  it('reports a refusal from the server rather than swallowing it', async () => {
    renderApp(
      '/admin/organisation',
      organisation({
        'POST /api/units': () =>
          errorResponse(409, 'unit_slug_taken', 'Another unit already uses that name'),
      }),
    )

    await userEvent.click(await screen.findByRole('button', { name: 'New unit' }))
    const dialog = await screen.findByRole('dialog', { name: 'New unit' })
    await userEvent.type(within(dialog).getByLabelText('Name', { exact: false }), 'Acme')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Another unit already uses that name',
    )
  })

  it('has no axe violations', async () => {
    const { container } = renderApp('/admin/organisation', organisation())
    await screen.findByRole('heading', { level: 1, name: 'Organisation' })

    await expectNoAccessibilityViolations(container)
  })
})
