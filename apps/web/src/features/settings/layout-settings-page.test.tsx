import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { expectNoAccessibilityViolations } from '@quill/ui/testing/axe'

import { renderApp } from '../../lib/api/render-app.tsx'
import { errorResponse, jsonResponse, type FakeRoutes } from '../../lib/api/testing.ts'
import {
  admin,
  member,
  NEXT_REVISION,
  organisationSettings,
  readOrganisation,
  REVISION,
  themeReport,
} from './settings-fixtures.ts'

const PATH = '/admin/settings/layout'

function routes(extra: FakeRoutes = {}): FakeRoutes {
  return {
    'GET /api/me': admin,
    'GET /api/settings/organisation': readOrganisation(),
    ...extra,
  }
}

function recordingPut(bodies: Array<Record<string, unknown>>) {
  return async (request: Request) => {
    const body = (await request.json()) as Record<string, unknown>
    bodies.push(body)
    return jsonResponse(200, {
      revision: NEXT_REVISION,
      settings: body['settings'],
      report: themeReport(),
    })
  }
}

describe('the organisation’s layout settings', () => {
  it('shows the default every workspace starts with', async () => {
    renderApp(PATH, routes())

    expect(await screen.findByRole('heading', { level: 1, name: 'Layout' })).toBeVisible()
    expect(screen.getByRole('radio', { name: /Tree/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /Side panel/ })).toBeChecked()
  })

  it('saves a changed default with the revision it was read at', async () => {
    const bodies: Array<Record<string, unknown>> = []
    renderApp(PATH, routes({ 'PUT /api/settings/organisation': recordingPut(bodies) }))

    await userEvent.click(await screen.findByRole('radio', { name: /Collection tabs/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(bodies).toHaveLength(1)
    })
    expect(bodies[0]).toMatchObject({ expectedRevision: REVISION })
    const saved = bodies[0]?.['settings'] as {
      layout: { default: { navigation: string; comments: string }; locked: boolean }
    }
    expect(saved.layout.default.navigation).toBe('tabs')
    // One axis moved; nothing else did.
    expect(saved.layout.default.comments).toBe('panel')
  })

  it('locks layout for every workspace, which is a different decision from the default', async () => {
    const bodies: Array<Record<string, unknown>> = []
    renderApp(PATH, routes({ 'PUT /api/settings/organisation': recordingPut(bodies) }))

    await userEvent.click(
      await screen.findByRole('checkbox', { name: 'Every workspace uses this arrangement' }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(bodies).toHaveLength(1)
    })
    const saved = bodies[0]?.['settings'] as { layout: { locked: boolean } }
    expect(saved.layout.locked).toBe(true)
  })

  it('shows the arrangement somebody else saved when the write conflicts', async () => {
    let read = organisationSettings()
    renderApp(
      PATH,
      routes({
        'GET /api/settings/organisation': () =>
          jsonResponse(200, { revision: REVISION, settings: read }),
        'PUT /api/settings/organisation': () => {
          read = organisationSettings({
            layout: {
              default: {
                comments: 'sidenotes',
                history: 'menu',
                navigation: 'tabs',
                header: 'breadcrumb',
                rules: 'cards',
              },
              locked: true,
            },
          })
          return errorResponse(409, 'settings_conflict', 'Somebody else changed these settings', {
            revision: NEXT_REVISION,
          })
        },
      }),
    )

    await userEvent.click(await screen.findByRole('radio', { name: /Collection tabs/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText(/Somebody else changed these layout settings/)).toBeVisible()
    expect(
      await screen.findByText(/Navigation: Collection tabs, Comments: Sidenotes/),
    ).toBeVisible()
    expect(screen.getByText(/Workspaces may not choose their own arrangement/)).toBeVisible()

    await userEvent.click(screen.getByRole('button', { name: 'Load their version' }))

    expect(
      screen.getByRole('checkbox', { name: 'Every workspace uses this arrangement' }),
    ).toBeChecked()
  })

  it('names the field a refused layout was refused for', async () => {
    renderApp(
      PATH,
      routes({
        'PUT /api/settings/organisation': () =>
          errorResponse(422, 'invalid_settings', 'These settings are not valid', {
            issues: [{ path: '/layout/default/rules', message: 'unknown variant', rule: 'enum' }],
          }),
      }),
    )

    await userEvent.click(await screen.findByRole('radio', { name: /Collection tabs/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText(/unknown variant/)).toBeVisible()
  })

  it('is not a page a member can reach', async () => {
    renderApp(PATH, routes({ 'GET /api/me': member }))

    expect(await screen.findByText('This page is not available')).toBeVisible()
  })

  it('has no accessibility violations', async () => {
    const { container } = renderApp(PATH, routes())

    await screen.findByRole('heading', { level: 1, name: 'Layout' })
    await expectNoAccessibilityViolations(container)
  })
})
