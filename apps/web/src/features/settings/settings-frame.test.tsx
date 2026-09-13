import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { renderApp } from '../../lib/api/render-app.tsx'
import { jsonResponse, type FakeRoutes } from '../../lib/api/testing.ts'
import { admin, member, readOrganisation } from './settings-fixtures.ts'

function routes(extra: FakeRoutes = {}): FakeRoutes {
  return {
    'GET /api/me': admin,
    'GET /api/settings/organisation': readOrganisation(),
    'GET /api/settings/secrets': () => jsonResponse(200, []),
    'GET /api/auth/oidc/providers': () => jsonResponse(200, { providers: [] }),
    ...extra,
  }
}

describe('the settings area', () => {
  it('opens on the organisation, because a landing page nobody reads twice is not an answer', async () => {
    const { router } = renderApp('/admin/settings', routes())

    expect(await screen.findByRole('heading', { level: 1, name: 'Organisation' })).toBeVisible()
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/admin/settings/organisation')
    })
  })

  it('marks the section being read, as an attribute rather than a chosen class', async () => {
    renderApp('/admin/settings/theme', routes())

    const nav = await screen.findByRole('navigation', { name: 'Settings' })
    expect(within(nav).getByRole('link', { name: 'Theme' })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByRole('link', { name: 'Organisation' })).not.toHaveAttribute(
      'aria-current',
    )
  })

  it('keeps the navigation while moving between screens', async () => {
    renderApp('/admin/settings/organisation', routes())

    const nav = await screen.findByRole('navigation', { name: 'Settings' })
    await userEvent.click(within(nav).getByRole('link', { name: 'Secrets and sign-in' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Secrets' })).toBeVisible()
    // The same node, not a remounted one: the frame is a layout route.
    expect(screen.getByRole('navigation', { name: 'Settings' })).toBe(nav)
  })

  it('is one gate, at the top, and a member never sees the section', async () => {
    renderApp('/admin/settings/secrets', routes({ 'GET /api/me': member }))

    expect(await screen.findByText('This page is not available')).toBeVisible()
    expect(screen.queryByRole('navigation', { name: 'Settings' })).not.toBeInTheDocument()
  })

  it('is reached from the organisation admin page', async () => {
    renderApp(
      '/admin/organisation',
      routes({
        'GET /api/units': () => jsonResponse(200, []),
        'GET /api/workspaces': () => jsonResponse(200, []),
      }),
    )

    expect(await screen.findByRole('link', { name: 'Settings' })).toHaveAttribute(
      'href',
      '/admin/settings',
    )
  })

  it('shows the organisation’s own name in the bar, not the product’s', async () => {
    renderApp('/admin/settings/organisation', routes())

    // ADR-034 makes this the organisation's to decide, and the API contract
    // makes it readable by any session for exactly this reason.
    expect(await screen.findByRole('link', { name: 'Acme' })).toBeVisible()
  })
})

/**
 * All four instance screens edit one document and sit one click apart, so
 * moving between them used to discard whatever was in the form without saying
 * so — the one outcome a person can neither notice nor recover from.
 */
describe('leaving a settings screen with unsaved changes', () => {
  it('asks before discarding them, and stays put if the answer is no', async () => {
    renderApp('/admin/settings/organisation', routes())

    await userEvent.type(await screen.findByLabelText('Organisation name'), ' Holdings')
    await userEvent.click(
      within(screen.getByRole('navigation', { name: 'Settings' })).getByRole('link', {
        name: 'Layout',
      }),
    )

    const dialog = await screen.findByRole('dialog', {
      name: 'Leave without saving the organisation settings?',
    })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Stay and keep editing' }))

    expect(screen.getByLabelText('Organisation name')).toHaveValue('Acme Holdings')
    expect(screen.getByRole('heading', { level: 1, name: 'Organisation' })).toBeVisible()
  })

  it('lets them go when that is what was asked for', async () => {
    renderApp('/admin/settings/organisation', routes())

    await userEvent.type(await screen.findByLabelText('Organisation name'), ' Holdings')
    await userEvent.click(
      within(screen.getByRole('navigation', { name: 'Settings' })).getByRole('link', {
        name: 'Layout',
      }),
    )

    const dialog = await screen.findByRole('dialog', { name: /Leave without saving/ })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Discard them' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Layout' })).toBeVisible()
  })

  it('does not ask when nothing has been changed', async () => {
    renderApp('/admin/settings/organisation', routes())

    await screen.findByRole('heading', { level: 1, name: 'Organisation' })
    await userEvent.click(
      within(screen.getByRole('navigation', { name: 'Settings' })).getByRole('link', {
        name: 'Layout',
      }),
    )

    expect(await screen.findByRole('heading', { level: 1, name: 'Layout' })).toBeVisible()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
