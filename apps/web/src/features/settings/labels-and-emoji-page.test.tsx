import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { expectNoAccessibilityViolations } from '@quill/ui/testing/axe'

import type { OrganisationSettings } from '../../lib/api/index.ts'
import { renderApp } from '../../lib/api/render-app.tsx'
import { errorResponse, jsonResponse, type FakeRoutes } from '../../lib/api/testing.ts'
import {
  admin,
  NEXT_REVISION,
  organisationSettings,
  readOrganisation,
  REVISION,
  themeReport,
} from './settings-fixtures.ts'

const PATH = '/admin/settings/labels'

const SUPPORT = { name: 'support', title: 'Support', hue: 250, chroma: 0.12 }

function routes(extra: FakeRoutes = {}): FakeRoutes {
  return {
    'GET /api/me': admin,
    'GET /api/settings/organisation': readOrganisation(),
    ...extra,
  }
}

function recordingPut(bodies: Array<{ settings: OrganisationSettings }>) {
  return async (request: Request) => {
    const body = (await request.json()) as { settings: OrganisationSettings }
    bodies.push(body)
    return jsonResponse(200, {
      revision: NEXT_REVISION,
      settings: body.settings,
      report: themeReport(),
    })
  }
}

describe('the labels and emoji screen', () => {
  it('is its own settings section, after Theme', async () => {
    renderApp(PATH, routes())

    expect(await screen.findByRole('heading', { level: 1, name: 'Labels and emoji' })).toBeVisible()
    const nav = screen.getByRole('navigation', { name: 'Settings' })
    const sections = [...nav.querySelectorAll('a')].map((link) => link.textContent)
    expect(sections.indexOf('Labels and emoji')).toBe(sections.indexOf('Theme') + 1)
    expect(screen.getByRole('link', { name: 'Labels and emoji' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it('edits the labels and the emoji, under headings of their own', async () => {
    renderApp(PATH, routes())

    expect(await screen.findByRole('heading', { level: 2, name: 'Labels' })).toBeVisible()
    expect(screen.getByRole('heading', { level: 2, name: 'Emoji' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Add label' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Add emoji' })).toBeVisible()
  })

  it('saves a label into the theme, forking the built-in, at the revision it read', async () => {
    const bodies: Array<{ settings: OrganisationSettings }> = []
    renderApp(PATH, routes({ 'PUT /api/settings/organisation': recordingPut(bodies) }))
    const user = userEvent.setup()

    const labels = await screen.findByRole('group', { name: 'Labels' })
    await user.type(within(labels).getByLabelText('Name'), 'support')
    await user.click(screen.getByRole('button', { name: 'Add label' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(bodies).toHaveLength(1)
    })
    const [sent] = bodies
    expect(sent).toMatchObject({ expectedRevision: REVISION })
    expect(sent?.settings.theme.labels?.map((label) => label.name)).toEqual(['support'])
    expect(sent?.settings.theme.base).toBe('instrument')
    // The rest of the theme is what was read, untouched.
    expect(sent?.settings.theme.seeds).toEqual(organisationSettings().theme.seeds)
    expect(await screen.findByText(/nothing to save/)).toBeVisible()
  })

  it('shows the labels somebody else saved when the write conflicts, and offers theirs', async () => {
    const withSupport = organisationSettings({
      theme: { ...organisationSettings().theme, labels: [SUPPORT] },
    })
    let read = organisationSettings()
    renderApp(
      PATH,
      routes({
        'GET /api/settings/organisation': () =>
          jsonResponse(200, { revision: REVISION, settings: read }),
        'PUT /api/settings/organisation': () => {
          read = withSupport
          return errorResponse(409, 'settings_conflict', 'Somebody else changed these settings', {
            revision: NEXT_REVISION,
          })
        },
      }),
    )
    const user = userEvent.setup()

    const labels = await screen.findByRole('group', { name: 'Labels' })
    await user.type(within(labels).getByLabelText('Name'), 'billing')
    await user.click(screen.getByRole('button', { name: 'Add label' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText(/Somebody else changed these labels and emoji/)).toBeVisible()
    expect(await screen.findByText('Labels: Support')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Load their version' }))
    expect(screen.getByText(':support[Support]')).toBeInTheDocument()
  })

  it('has no accessibility violations', async () => {
    const { container } = renderApp(
      PATH,
      routes({
        'GET /api/settings/organisation': readOrganisation(
          organisationSettings({ theme: { ...organisationSettings().theme, labels: [SUPPORT] } }),
        ),
      }),
    )

    await screen.findByRole('heading', { level: 1, name: 'Labels and emoji' })
    await expectNoAccessibilityViolations(container)
  })
})
