import { screen, waitFor, within } from '@testing-library/react'
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

const PATH = '/admin/settings/organisation'

function routes(extra: FakeRoutes = {}): FakeRoutes {
  return {
    'GET /api/me': admin,
    'GET /api/settings/organisation': readOrganisation(),
    ...extra,
  }
}

/** A `PUT` that records the body and answers as the server does. */
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

describe('the organisation settings screen', () => {
  it('shows the organisation as it is saved', async () => {
    renderApp(PATH, routes())

    expect(await screen.findByRole('heading', { level: 1, name: 'Organisation' })).toBeVisible()
    expect(screen.getByLabelText('Organisation name')).toHaveValue('Acme')
    expect(screen.getByDisplayValue('/handbook')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Allow share links' })).toBeChecked()
    expect(
      screen.getByRole('checkbox', { name: 'Allow publishing to the public web' }),
    ).not.toBeChecked()
  })

  it('saves the edited settings with the revision they were read at', async () => {
    const bodies: Array<Record<string, unknown>> = []
    renderApp(PATH, routes({ 'PUT /api/settings/organisation': recordingPut(bodies) }))

    const name = await screen.findByLabelText('Organisation name')
    await userEvent.clear(name)
    await userEvent.type(name, 'Globex')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(bodies).toHaveLength(1)
    })
    expect(bodies[0]).toMatchObject({ expectedRevision: REVISION })
    const saved = bodies[0]?.['settings'] as { name: string }
    expect(saved.name).toBe('Globex')
  })

  it('has nothing to save until something changes', async () => {
    renderApp(PATH, routes())

    expect(await screen.findByRole('button', { name: 'Save' })).toBeDisabled()
    // Disabled with its reason beside it, never silently inert
    // (docs/design/feedback.md).
    expect(screen.getByText(/Nothing has changed yet/)).toBeVisible()
  })

  it('refuses to save an empty name, and says why', async () => {
    renderApp(PATH, routes())

    await userEvent.clear(await screen.findByLabelText('Organisation name'))

    expect(screen.getByText('Give the organisation a name.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('refuses a navigation address the public site would not accept', async () => {
    renderApp(PATH, routes())

    const href = await screen.findByDisplayValue('/handbook')
    await userEvent.clear(href)
    // A whitelist, not a blacklist: script in a tenant's navigation bar is
    // stored XSS on a page nobody has to sign in to reach.
    await userEvent.type(href, 'javascript:alert(1)')

    expect(
      screen.getByText('Use a path on this site, such as /handbook, or a full https:// address.'),
    ).toBeVisible()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it.each(['//evil.example', 'data:text/html,x'])('refuses %s as an address', async (href) => {
    renderApp(PATH, routes())

    const field = await screen.findByDisplayValue('/handbook')
    await userEvent.clear(field)
    await userEvent.type(field, href)

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('accepts an absolute https address', async () => {
    renderApp(PATH, routes())

    const field = await screen.findByDisplayValue('/handbook')
    await userEvent.clear(field)
    await userEvent.type(field, 'https://acme.example/handbook')

    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })

  it('adds, reorders and removes navigation links', async () => {
    const bodies: Array<Record<string, unknown>> = []
    renderApp(PATH, routes({ 'PUT /api/settings/organisation': recordingPut(bodies) }))

    await userEvent.click(await screen.findByRole('button', { name: 'Add a link' }))
    const rows = within(screen.getByRole('list', { name: 'Public navigation links' })).getAllByRole(
      'listitem',
    )
    const added = rows[1]
    if (added === undefined) throw new Error('the new row was not rendered')
    await userEvent.type(within(added).getByLabelText('Name'), 'Policies')
    await userEvent.type(within(added).getByLabelText('Address'), '/policies')

    await userEvent.click(screen.getByRole('button', { name: 'Move Policies up' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(bodies).toHaveLength(1)
    })
    const saved = bodies[0]?.['settings'] as {
      publicNavigation: readonly { label: string; href: string }[]
    }
    expect(saved.publicNavigation).toEqual([
      { label: 'Policies', href: '/policies' },
      { label: 'Handbook', href: '/handbook' },
    ])

    await userEvent.click(screen.getByRole('button', { name: 'Remove Policies' }))
    expect(screen.queryByDisplayValue('/policies')).not.toBeInTheDocument()
  })

  it('shows what somebody else saved when the write conflicts, and offers their version', async () => {
    const theirs = organisationSettings({ name: 'Their Acme' })
    let read = organisationSettings()
    renderApp(
      PATH,
      routes({
        'GET /api/settings/organisation': () =>
          jsonResponse(200, { revision: REVISION, settings: read }),
        'PUT /api/settings/organisation': () => {
          // The conflict means this entry is stale, so the next read answers
          // with what is actually on the server.
          read = theirs
          return errorResponse(
            409,
            'settings_conflict',
            'Somebody else changed these settings while you were editing them',
            { revision: NEXT_REVISION },
          )
        },
      }),
    )

    const name = await screen.findByLabelText('Organisation name')
    await userEvent.clear(name)
    await userEvent.type(name, 'Mine')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(
      await screen.findByText(/Somebody else changed these organisation settings/),
    ).toBeVisible()
    // Their values, not a warning about them.
    expect(await screen.findByText('Name: Their Acme')).toBeVisible()

    await userEvent.click(screen.getByRole('button', { name: 'Load their version' }))

    expect(screen.getByLabelText('Organisation name')).toHaveValue('Their Acme')
    expect(screen.queryByText(/Somebody else changed/)).not.toBeInTheDocument()
  })

  it('names the field a refused document was refused for', async () => {
    renderApp(
      PATH,
      routes({
        'PUT /api/settings/organisation': () =>
          errorResponse(422, 'invalid_settings', 'These settings are not valid', {
            issues: [
              { path: '/publicNavigation/0/href', message: 'must match pattern', rule: 'pattern' },
            ],
          }),
      }),
    )

    const name = await screen.findByLabelText('Organisation name')
    await userEvent.type(name, '!')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText(/must match pattern/)).toBeVisible()
    expect(screen.getByText('/publicNavigation/0/href')).toBeVisible()
  })

  it('shows the logo as a reference, with no control that cannot work yet', async () => {
    renderApp(
      PATH,
      routes({
        'GET /api/settings/organisation': readOrganisation(
          organisationSettings({
            logo: { hash: 'f'.repeat(64), mediaType: 'image/png', alt: 'Acme' },
          }),
        ),
      }),
    )

    expect(await screen.findByText(/image\/png/)).toBeVisible()
    // Uploading arrives with attachments; an upload control that cannot work
    // is not rendered at all (docs/design/feedback.md).
    expect(screen.queryByLabelText(/upload/i)).not.toBeInTheDocument()
  })

  it('is not a page a member can reach', async () => {
    renderApp(PATH, routes({ 'GET /api/me': member }))

    expect(await screen.findByText('This page is not available')).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'Organisation' })).not.toBeInTheDocument()
  })

  it('offers the repair path when the settings file cannot be read', async () => {
    const bodies: Array<Record<string, unknown>> = []
    renderApp(
      PATH,
      routes({
        'GET /api/settings/organisation': () =>
          errorResponse(500, 'settings_unreadable', 'This instance cannot read its own settings', {
            revision: REVISION,
          }),
        'PUT /api/settings/organisation': recordingPut(bodies),
      }),
    )

    expect(await screen.findByText('This instance cannot read its own settings file')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Replace with the default settings' }))
    const dialog = await screen.findByRole('dialog', { name: 'Replace the settings file?' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Replace' }))

    await waitFor(() => {
      expect(bodies).toHaveLength(1)
    })
    // The repair is a `PUT` at the revision the failure reported: that is what
    // makes it an API action rather than an edit to a repository by hand.
    expect(bodies[0]).toMatchObject({ expectedRevision: REVISION })
  })

  it('offers no repair control to somebody the server gave no revision', async () => {
    renderApp(
      PATH,
      routes({
        'GET /api/settings/organisation': () =>
          errorResponse(500, 'settings_unreadable', 'This instance cannot read its own settings'),
      }),
    )

    expect(await screen.findByText('This instance cannot read its own settings file')).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Replace with the default settings' }),
    ).not.toBeInTheDocument()
  })

  it('says so plainly when the settings could not be loaded at all', async () => {
    renderApp(
      PATH,
      routes({
        'GET /api/settings/organisation': () =>
          errorResponse(500, 'internal_error', 'Something went wrong'),
      }),
    )

    expect(await screen.findByText("Couldn't load these settings")).toBeVisible()
  })

  it('has no accessibility violations', async () => {
    const { container } = renderApp(PATH, routes())

    await screen.findByRole('heading', { level: 1, name: 'Organisation' })
    await expectNoAccessibilityViolations(container)
  })
})
