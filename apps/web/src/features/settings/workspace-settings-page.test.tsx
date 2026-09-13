import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { expectNoAccessibilityViolations } from '@quill/ui/testing/axe'

import type { LayoutSettings } from '../../lib/api/index.ts'
import { renderApp } from '../../lib/api/render-app.tsx'
import { errorResponse, jsonResponse, type FakeRoutes } from '../../lib/api/testing.ts'
import { admin, member, NEXT_REVISION, REVISION } from './settings-fixtures.ts'

const PATH = '/w/acme/settings'

const INHERITED: LayoutSettings = {
  comments: 'panel',
  history: 'timeline',
  navigation: 'tree',
  header: 'readout',
  rules: 'hairline',
}

const workspace = () =>
  jsonResponse(200, {
    id: 'ws-1',
    unitId: 'unit-1',
    name: 'Acme',
    slug: 'acme',
    createdAt: '2026-01-01T00:00:00.000Z',
  })

interface SettingsOptions {
  readonly layout?: LayoutSettings
  readonly locked?: boolean
  readonly effective?: LayoutSettings
}

function workspaceSettings(options: SettingsOptions = {}) {
  const { layout, locked = false, effective = options.layout ?? INHERITED } = options
  return () =>
    jsonResponse(200, {
      revision: REVISION,
      settings: {
        version: 1,
        workspaceId: 'ws-1',
        ...(layout === undefined ? {} : { layout }),
      },
      effective: {
        layout: effective,
        layoutSource: layout === undefined ? 'organisation' : 'workspace',
        layoutLocked: locked,
      },
    })
}

function routes(extra: FakeRoutes = {}): FakeRoutes {
  return {
    'GET /api/me': admin,
    'GET /api/workspaces': () => jsonResponse(200, []),
    'GET /api/workspaces/{id}': workspace,
    'GET /api/workspaces/{id}/tree': () => jsonResponse(200, { collections: [] }),
    'GET /api/workspaces/{id}/settings': workspaceSettings(),
    ...extra,
  }
}

function recordingPut(bodies: Array<Record<string, unknown>>) {
  return async (request: Request) => {
    const body = (await request.json()) as Record<string, unknown>
    bodies.push(body)
    return jsonResponse(200, { revision: NEXT_REVISION, settings: body['settings'] })
  }
}

describe('a workspace’s settings', () => {
  it('renders inside the workspace shell', async () => {
    renderApp(PATH, routes())

    expect(await screen.findByRole('heading', { level: 1, name: 'Acme settings' })).toBeVisible()
    // The shell is still there to go somewhere else with.
    expect(screen.getByRole('navigation', { name: 'Documents' })).toBeInTheDocument()
  })

  it('offers no identity: that belongs to the organisation', async () => {
    renderApp(PATH, routes())

    await screen.findByRole('heading', { level: 1, name: 'Acme settings' })
    expect(screen.queryByLabelText('Accent hue')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Reading face')).not.toBeInTheDocument()
  })

  it('inherits by default, and says what that is today', async () => {
    renderApp(PATH, routes())

    expect(
      await screen.findByRole('radio', { name: 'Follow the organisation’s default' }),
    ).toBeChecked()
    expect(screen.getByText(/Today that is Navigation: Tree/)).toBeVisible()
    // The axes only appear once this workspace is choosing for itself.
    expect(screen.queryByRole('group', { name: 'Navigation' })).not.toBeInTheDocument()
  })

  it('overrides the organisation’s default, writing a layout of its own', async () => {
    const bodies: Array<Record<string, unknown>> = []
    renderApp(PATH, routes({ 'PUT /api/workspaces/{id}/settings': recordingPut(bodies) }))

    await userEvent.click(await screen.findByRole('radio', { name: 'Choose for this workspace' }))
    await userEvent.click(screen.getByRole('radio', { name: /Sidenotes/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(bodies).toHaveLength(1)
    })
    expect(bodies[0]).toMatchObject({ expectedRevision: REVISION })
    const saved = bodies[0]?.['settings'] as { layout: LayoutSettings; workspaceId: string }
    expect(saved.workspaceId).toBe('ws-1')
    expect(saved.layout.comments).toBe('sidenotes')
  })

  it('goes back to inheriting by dropping the layout, not by copying the default', async () => {
    const bodies: Array<Record<string, unknown>> = []
    renderApp(
      PATH,
      routes({
        'GET /api/workspaces/{id}/settings': workspaceSettings({
          layout: { ...INHERITED, navigation: 'tabs' },
        }),
        'PUT /api/workspaces/{id}/settings': recordingPut(bodies),
      }),
    )

    await userEvent.click(
      await screen.findByRole('radio', { name: 'Follow the organisation’s default' }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(bodies).toHaveLength(1)
    })
    // Absence is what inheriting means: a copy would stop following the
    // organisation the next time it changed its default.
    expect(bodies[0]?.['settings']).toEqual({ version: 1, workspaceId: 'ws-1' })
  })

  it('shows the locked arrangement, refused rather than hidden', async () => {
    renderApp(
      PATH,
      routes({
        'GET /api/workspaces/{id}/settings': workspaceSettings({
          locked: true,
          effective: { ...INHERITED, rules: 'cards' },
        }),
      }),
    )

    expect(await screen.findByText('The organisation decides the layout')).toBeVisible()
    // Once in the notice that names who decided, once in the "today that is" line.
    expect(screen.getAllByText(/Dividers: Cards/).length).toBeGreaterThan(0)
    expect(screen.getByRole('radio', { name: 'Choose for this workspace' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('says so when the lock is turned on while the page is open', async () => {
    renderApp(
      PATH,
      routes({
        'PUT /api/workspaces/{id}/settings': () =>
          errorResponse(
            409,
            'workspace_layout_locked',
            'This organisation decides the layout for every workspace',
          ),
      }),
    )

    await userEvent.click(await screen.findByRole('radio', { name: 'Choose for this workspace' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('This layout was refused')).toBeVisible()
    expect(screen.getByText(/locked layout while this page was open/)).toBeVisible()
  })

  it('shows what somebody else saved when the write conflicts', async () => {
    let read = workspaceSettings()
    renderApp(
      PATH,
      routes({
        'GET /api/workspaces/{id}/settings': () => read(),
        'PUT /api/workspaces/{id}/settings': () => {
          read = workspaceSettings({ layout: { ...INHERITED, header: 'breadcrumb' } })
          return errorResponse(409, 'settings_conflict', 'Somebody else changed these settings', {
            revision: NEXT_REVISION,
          })
        },
      }),
    )

    await userEvent.click(await screen.findByRole('radio', { name: 'Choose for this workspace' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText(/Somebody else changed these workspace settings/)).toBeVisible()
    expect(await screen.findByText(/Header: Breadcrumb bar/)).toBeVisible()

    await userEvent.click(screen.getByRole('button', { name: 'Load their version' }))

    expect(screen.getByRole('radio', { name: /Breadcrumb bar/ })).toBeChecked()
  })

  it('is not a page somebody who cannot manage the workspace reaches', async () => {
    renderApp(PATH, routes({ 'GET /api/me': member }))

    expect(await screen.findByText('This page is not available')).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'Acme settings' })).not.toBeInTheDocument()
  })

  it('is offered from the workspace overflow, and only to somebody who can open it', async () => {
    renderApp('/w/acme', routes())

    await screen.findByRole('navigation', { name: 'Documents' })
    await userEvent.click(
      screen.getByRole('button', { name: 'More actions for the Acme workspace' }),
    )

    expect(await screen.findByRole('menuitem', { name: 'Workspace settings' })).toBeVisible()
  })

  it('is absent from the overflow for somebody who cannot open it', async () => {
    renderApp('/w/acme', {
      ...routes({ 'GET /api/me': member }),
      'GET /api/workspaces/{workspaceId}/documents': () => jsonResponse(200, []),
    })

    await screen.findByRole('navigation', { name: 'Documents' })
    // A menu with nothing in it is not a menu (docs/design/feedback.md).
    expect(
      screen.queryByRole('button', { name: 'More actions for the Acme workspace' }),
    ).not.toBeInTheDocument()
  })

  it('has no accessibility violations', async () => {
    const { container } = renderApp(PATH, routes())

    await screen.findByRole('heading', { level: 1, name: 'Acme settings' })
    await expectNoAccessibilityViolations(container)
  })
})
