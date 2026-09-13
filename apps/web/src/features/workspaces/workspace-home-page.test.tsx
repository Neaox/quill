import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { renderApp } from '../../lib/api/render-app.tsx'
import { errorResponse, jsonResponse } from '../../lib/api/testing.ts'

const me = () =>
  jsonResponse(200, {
    id: 'user-1',
    email: 'reader@example.com',
    displayName: 'Reader',
    emailVerified: true,
    isInstanceAdmin: false,
  })

const workspace = () =>
  jsonResponse(200, {
    id: 'acme',
    unitId: 'unit-1',
    name: 'Acme',
    slug: 'acme',
    createdAt: '2026-01-01T00:00:00.000Z',
  })

const emptyTree = () => jsonResponse(200, { collections: [] })

describe('WorkspaceHomePage', () => {
  it('says so, inside the shell, when the workspace does not exist', async () => {
    renderApp('/w/acme', {
      'GET /api/me': me,
      'GET /api/workspaces/{id}': () => errorResponse(404, 'not_found', 'Workspace not found'),
    })

    expect(await screen.findByText("We couldn't find that workspace")).toBeInTheDocument()
  })

  it('shows an error when the document list fails to load, keeping the shell', async () => {
    renderApp('/w/acme', {
      'GET /api/me': me,
      'GET /api/workspaces/{id}': workspace,
      'GET /api/workspaces/{id}/tree': emptyTree,
      'GET /api/workspaces/{workspaceId}/documents': () =>
        errorResponse(403, 'forbidden', 'Workspace admin required'),
    })

    expect(await screen.findByText('Workspace admin required')).toBeInTheDocument()
    // The shell is still there to go somewhere else with.
    expect(screen.getByRole('navigation', { name: 'Documents' })).toBeInTheDocument()
  })

  it('offers the first collection when the workspace has none, because a document needs one', async () => {
    const created: string[] = []
    renderApp('/w/acme', {
      'GET /api/me': me,
      'GET /api/workspaces/{id}': workspace,
      'GET /api/workspaces/{id}/tree': emptyTree,
      'GET /api/workspaces/{workspaceId}/documents': () => jsonResponse(200, []),
      'POST /api/workspaces/{id}/collections': async (request) => {
        const body = (await request.json()) as { name: string }
        created.push(body.name)
        return jsonResponse(201, {
          id: 'col-1',
          workspaceId: 'acme',
          name: body.name,
          slug: 'guides',
          createdAt: '2026-01-01T00:00:00.000Z',
        })
      },
    })

    await userEvent.click(
      await screen.findByRole('button', { name: 'Create the first collection' }),
    )
    const dialog = await screen.findByRole('dialog', { name: 'New collection' })
    await userEvent.type(within(dialog).getByLabelText('Name', { exact: false }), 'Guides')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }))

    expect(created).toEqual(['Guides'])
  })
})
