import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { expectNoAccessibilityViolations } from '@quill/ui/testing/axe'

import { renderApp } from '../../lib/api/render-app.tsx'
import { errorResponse, jsonResponse, type FakeRoutes } from '../../lib/api/testing.ts'
import { DEFAULT_LINK_SETTINGS } from './link-settings-model.ts'
import type { LinkSettings } from './link-settings-model.ts'
import {
  admin,
  NEXT_REVISION,
  organisationSettings,
  readOrganisation,
  REVISION,
  themeReport,
} from './settings-fixtures.ts'

const PATH = '/admin/settings/links'

function routes(extra: FakeRoutes = {}, linkPreviews?: LinkSettings): FakeRoutes {
  return {
    'GET /api/me': admin,
    'GET /api/settings/organisation': readOrganisation(
      organisationSettings(linkPreviews === undefined ? {} : { linkPreviews }),
    ),
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

const savedLinks = (bodies: Array<Record<string, unknown>>): LinkSettings | undefined =>
  (bodies[0]?.['settings'] as { linkPreviews?: LinkSettings } | undefined)?.linkPreviews

describe('the link settings screen', () => {
  it('shows the defaults for an organisation that never saved any, and is accessible', async () => {
    const { container } = renderApp(PATH, routes())

    expect(await screen.findByRole('heading', { level: 1, name: 'Links' })).toBeVisible()
    expect(screen.getByRole('radio', { name: 'Rich' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Inline' })).toBeChecked()
    expect(
      screen.getByRole('switch', { name: 'Show previews on the public site and share links' }),
    ).toBeChecked()
    expect(screen.getByLabelText('Only these sites')).toHaveValue('')
    expect(screen.getByLabelText('Never these sites')).toHaveValue('')
    await expectNoAccessibilityViolations(container)
  })

  it('shows what is saved', async () => {
    renderApp(
      PATH,
      routes(
        {},
        {
          mode: 'text',
          publicSite: false,
          defaultDisplay: 'card',
          allow: ['docs.example.com'],
          block: ['ads.example', '*.tracker.example'],
        },
      ),
    )

    expect(await screen.findByRole('radio', { name: 'Text only' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Card' })).toBeChecked()
    expect(
      screen.getByRole('switch', { name: 'Show previews on the public site and share links' }),
    ).not.toBeChecked()
    expect(screen.getByLabelText('Only these sites')).toHaveValue('docs.example.com')
    expect(screen.getByLabelText('Never these sites')).toHaveValue('ads.example\n*.tracker.example')
  })

  it('has nothing to save until something changes, and says so', async () => {
    renderApp(PATH, routes())

    expect(await screen.findByRole('button', { name: 'Save' })).toBeDisabled()
    expect(screen.getByText(/Nothing has changed yet/u)).toBeVisible()
  })

  it('explains each mode and each display as it is chosen', async () => {
    renderApp(PATH, routes())

    await userEvent.click(await screen.findByRole('radio', { name: 'Off' }))
    expect(screen.getByRole('group', { name: 'Link previews' })).toHaveAccessibleDescription(
      /never contacts a site/u,
    )
    await userEvent.click(screen.getByRole('radio', { name: 'Compact' }))
    expect(screen.getByRole('group', { name: 'Default display' })).toHaveAccessibleDescription(
      /one line of their own/u,
    )
  })

  it('saves a mode, a display and the public-site switch with the revision they were read at', async () => {
    const bodies: Array<Record<string, unknown>> = []
    renderApp(PATH, routes({ 'PUT /api/settings/organisation': recordingPut(bodies) }))

    await userEvent.click(await screen.findByRole('radio', { name: 'Text only' }))
    await userEvent.click(screen.getByRole('radio', { name: 'Card' }))
    await userEvent.click(
      screen.getByRole('switch', { name: 'Show previews on the public site and share links' }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(bodies).toHaveLength(1)
    })
    expect(bodies[0]).toMatchObject({ expectedRevision: REVISION })
    expect(savedLinks(bodies)).toEqual({
      ...DEFAULT_LINK_SETTINGS,
      mode: 'text',
      publicSite: false,
      defaultDisplay: 'card',
    })
  })

  it('disables the public-site switch with its reason while previews are off', async () => {
    renderApp(PATH, routes())

    await userEvent.click(await screen.findByRole('radio', { name: 'Off' }))

    const toggle = screen.getByRole('switch', {
      name: 'Show previews on the public site and share links',
    })
    expect(toggle).toBeDisabled()
    expect(toggle).not.toBeChecked()
    expect(toggle).toHaveAccessibleDescription(/Previews are off/u)
    expect(screen.getByLabelText('Only these sites')).toBeDisabled()
  })

  it('saves the lists as clean patterns: trimmed, no blank lines, no repeats', async () => {
    const bodies: Array<Record<string, unknown>> = []
    renderApp(PATH, routes({ 'PUT /api/settings/organisation': recordingPut(bodies) }))

    await userEvent.type(
      await screen.findByLabelText('Never these sites'),
      '  ads.example {enter}{enter}*.tracker.example/pixel/*{enter}ADS.example',
    )
    await userEvent.type(screen.getByLabelText('Only these sites'), 'docs.example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(bodies).toHaveLength(1)
    })
    expect(savedLinks(bodies)).toMatchObject({
      allow: ['docs.example.com'],
      block: ['ads.example', '*.tracker.example/pixel/*'],
    })
  })

  it('names each refused pattern, by line, with the reason, and will not save until they are fixed', async () => {
    const { container } = renderApp(PATH, routes())

    const block = await screen.findByLabelText('Never these sites')
    await userEvent.type(block, 'fine.example{enter}not a host{enter}{enter}a.example/x*y')

    expect(block).toBeInvalid()
    const messages = within(screen.getByRole('alert')).getAllByRole('listitem')
    expect(messages).toHaveLength(2)
    expect(messages[0]).toHaveTextContent('Line 2, “not a host”')
    expect(messages[0]).toHaveTextContent(/host/u)
    expect(messages[1]).toHaveTextContent('Line 4, “a.example/x*y”')
    expect(messages[1]).toHaveTextContent(/path/u)
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(screen.getByText(/Some patterns are not valid yet/u)).toBeVisible()
    await expectNoAccessibilityViolations(container)

    await userEvent.clear(block)
    await userEvent.type(block, 'fine.example')
    expect(block).toBeValid()
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })

  it('explains how patterns work, with examples, where the lists are', async () => {
    renderApp(PATH, routes())

    const syntax = await screen.findByText('How patterns work')
    await userEvent.click(syntax)
    expect(screen.getByText('*.example.com')).toBeVisible()
    expect(screen.getByText(/never a regular expression/u)).toBeVisible()
  })

  it('shows what somebody else saved when the write conflicts', async () => {
    const theirs = organisationSettings({
      linkPreviews: { ...DEFAULT_LINK_SETTINGS, mode: 'off' },
    })
    let read = organisationSettings()
    renderApp(PATH, {
      ...routes(),
      'GET /api/settings/organisation': () =>
        jsonResponse(200, { revision: REVISION, settings: read }),
      'PUT /api/settings/organisation': () => {
        read = theirs
        return errorResponse(
          409,
          'settings_conflict',
          'Somebody else changed these settings while you were editing them',
          { revision: NEXT_REVISION },
        )
      },
    })

    await userEvent.click(await screen.findByRole('radio', { name: 'Card' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText(/Previews: Off/u)).toBeVisible()
  })
})
