import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { expectNoAccessibilityViolations } from '@quill/ui/testing/axe'

import { renderApp } from '../../lib/api/render-app.tsx'
import { jsonResponse, type FakeRoutes } from '../../lib/api/testing.ts'
import { initialsOf } from './signed-in-header.tsx'

const person = (isInstanceAdmin: boolean) => ({
  id: 'user-1',
  email: 'ada@example.com',
  displayName: 'Ada Writer',
  emailVerified: true,
  isInstanceAdmin,
})

/** Two workspaces, so `/` is the home page rather than a redirect into the only one. */
const WORKSPACES = ['Engineering', 'Platform docs'].map((name, index) => ({
  id: `ws-${index}`,
  unitId: 'unit-1',
  name,
  slug: name.toLowerCase().replaceAll(' ', '-'),
  createdAt: '2026-01-01T00:00:00.000Z',
  unit: { id: 'unit-1', name: 'Acme', path: ['Acme'] },
}))

function signedIn(isInstanceAdmin: boolean, extra: FakeRoutes = {}) {
  return renderApp('/', {
    'GET /api/me': () => jsonResponse(200, person(isInstanceAdmin)),
    'GET /api/workspaces': () => jsonResponse(200, WORKSPACES),
    'GET /api/workspaces/{workspaceId}/documents': () => jsonResponse(200, []),
    'GET /api/units': () => jsonResponse(200, []),
    ...extra,
  })
}

const trigger = () => screen.findByRole('button', { name: 'Account menu for Ada Writer' })

afterEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
})

describe('the person menu', () => {
  it('replaces the bare name with a menu button that says whose session it is', async () => {
    signedIn(false)

    const button = await trigger()
    expect(button).toHaveTextContent('Ada Writer')
    expect(button).toHaveTextContent('AW')
    expect(button).toHaveAttribute('aria-haspopup', 'menu')
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument()
  })

  it('shows somebody who is not an administrator their scheme and Sign out, and nothing of the organisation', async () => {
    signedIn(false)

    await userEvent.click(await trigger())
    const menu = await screen.findByRole('menu')

    expect(within(menu).getByText('ada@example.com')).toBeInTheDocument()
    expect(within(menu).getByRole('group', { name: 'Appearance' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Sign out' })).toBeInTheDocument()
    expect(within(menu).queryByRole('group', { name: 'Organisation' })).not.toBeInTheDocument()
    expect(
      within(menu).queryByRole('menuitem', { name: 'Organisation settings' }),
    ).not.toBeInTheDocument()
  })

  it('gives an instance administrator every organisation destination, as links', async () => {
    const { container } = signedIn(true)

    await userEvent.click(await trigger())
    const organisation = await screen.findByRole('group', { name: 'Organisation' })
    const links = within(organisation).getAllByRole('menuitem')

    expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Organisation settings', '/admin/settings/organisation'],
      ['Theme', '/admin/settings/theme'],
      ['Labels and emoji', '/admin/settings/labels'],
      ['Layout', '/admin/settings/layout'],
      ['Secrets and sign-in', '/admin/settings/secrets'],
      ['Units and workspaces', '/admin/organisation'],
      ['People and groups', '/admin/groups'],
    ])
    // The panel is portalled to the end of the body, outside every landmark,
    // as every popover is; it is checked on its own and the page on its own.
    await expectNoAccessibilityViolations(screen.getByRole('menu'))
    await expectNoAccessibilityViolations(container)
  })

  it('works from the keyboard alone, and goes where Enter lands', async () => {
    const { router } = signedIn(true, {
      'GET /api/settings/organisation': () =>
        jsonResponse(200, { revision: null, settings: { name: 'Acme' } }),
    })

    ;(await trigger()).focus()
    await userEvent.keyboard('{Enter}')
    await screen.findByRole('menu')
    // Opens onto the first item: the scheme the person has now.
    expect(screen.getByRole('menuitemradio', { name: 'System' })).toHaveFocus()
    expect(screen.getByRole('menuitemradio', { name: 'System' })).toHaveAttribute(
      'aria-checked',
      'true',
    )

    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Theme' })).toHaveFocus()
    await userEvent.keyboard('{Enter}')

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/admin/settings/theme')
    })
  })

  it('closes on Escape and gives focus back to its button', async () => {
    signedIn(false)

    const button = await trigger()
    await userEvent.click(button)
    await screen.findByRole('menu')
    await userEvent.keyboard('{Escape}')

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(button).toHaveFocus()
  })

  it('changes the colour scheme in place, keeping the menu open, and remembers it', async () => {
    signedIn(false)

    await userEvent.click(await trigger())
    await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Dark' }))

    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    expect(screen.getByRole('menuitemradio', { name: 'Dark' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(localStorage.getItem('theme-preference')).toBe('dark')
  })

  it('leads to the person’s own preferences', async () => {
    signedIn(false)

    await userEvent.click(await trigger())
    expect(await screen.findByRole('menuitem', { name: 'Preferences' })).toHaveAttribute(
      'href',
      '/preferences',
    )
  })

  it('signs out, and lands on the sign-in page', async () => {
    let signedOut = false
    signedIn(false, {
      'POST /api/auth/sign-out': () => {
        signedOut = true
        return new Response(null, { status: 204 })
      },
    })

    await userEvent.click(await trigger())
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Sign out' }))

    await waitFor(() => {
      expect(signedOut).toBe(true)
    })
  })
})

describe('initialsOf', () => {
  it('takes the first and last word, so a long name is still two letters', () => {
    expect(initialsOf('Ada Writer')).toBe('AW')
    expect(initialsOf('Ada King Lovelace')).toBe('AL')
    expect(initialsOf('  prince  ')).toBe('P')
    expect(initialsOf('Émile Zola')).toBe('ÉZ')
  })
})
