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

const appearanceRow = () => screen.getByRole('menuitem', { name: /^Appearance:/u })

describe('the person menu', () => {
  it('replaces the bare name with a menu button that says whose session it is', async () => {
    signedIn(false)

    const button = await trigger()
    expect(button).toHaveTextContent('Ada Writer')
    expect(button).toHaveTextContent('AW')
    expect(button).toHaveAttribute('aria-haspopup', 'menu')
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument()
  })

  it('shows somebody who is not an administrator who they are, their own settings and Sign out, and nothing of the organisation', async () => {
    signedIn(false)

    await userEvent.click(await trigger())
    const menu = await screen.findByRole('menu')

    expect(within(menu).getByText('ada@example.com')).toBeInTheDocument()
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Preferences', 'Appearance: System', 'Sign out'])
    expect(within(menu).queryByRole('group', { name: 'Organisation' })).not.toBeInTheDocument()
    expect(
      within(menu).queryByRole('menuitem', { name: 'Organisation settings' }),
    ).not.toBeInTheDocument()
  })

  it('gives an instance administrator the organisation in two items: its settings, which have a navigation of their own, and its units and workspaces', async () => {
    const { container } = signedIn(true)

    await userEvent.click(await trigger())
    const organisation = await screen.findByRole('group', { name: 'Organisation' })
    const links = within(organisation).getAllByRole('menuitem')

    expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Organisation settings', '/admin/settings'],
      ['Units and workspaces', '/admin/organisation'],
    ])
    // The panel is portalled to the end of the body, outside every landmark,
    // as every popover is; it is checked on its own and the page on its own.
    await expectNoAccessibilityViolations(screen.getByRole('menu'))
    await expectNoAccessibilityViolations(container)
  })

  it('draws the account’s initials with its name and email at the top of the panel', async () => {
    signedIn(false)

    await userEvent.click(await trigger())
    const menu = await screen.findByRole('menu')

    expect(within(menu).getByText('Ada Writer')).toBeInTheDocument()
    expect(within(menu).getByText('AW')).toBeInTheDocument()
  })

  it('works from the keyboard alone, and goes where Enter lands', async () => {
    const { router } = signedIn(true)

    ;(await trigger()).focus()
    await userEvent.keyboard('{Enter}')
    await screen.findByRole('menu')
    // Opens onto the first item.
    expect(screen.getByRole('menuitem', { name: 'Preferences' })).toHaveFocus()

    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Units and workspaces' })).toHaveFocus()
    await userEvent.keyboard('{Enter}')

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/admin/organisation')
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

  it('goes round the colour schemes from one row, in place, keeping the menu open, and remembers the one it stops on', async () => {
    signedIn(false)
    await userEvent.click(await trigger())

    await userEvent.click(await screen.findByRole('menuitem', { name: /^Appearance:\s*System$/u }))
    expect(document.documentElement).toHaveAttribute('data-theme', 'light')
    expect(appearanceRow()).toHaveTextContent('Light')
    await userEvent.click(appearanceRow())
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    expect(appearanceRow()).toHaveTextContent('Dark')
    expect(localStorage.getItem('theme-preference')).toBe('dark')
    expect(screen.getByRole('menu')).toBeInTheDocument()

    await userEvent.click(appearanceRow())
    expect(document.documentElement).not.toHaveAttribute('data-theme')
    expect(appearanceRow()).toHaveTextContent('System')
  })

  it('cycles the scheme from the keyboard with Enter, and says the new one', async () => {
    signedIn(false)
    ;(await trigger()).focus()
    await userEvent.keyboard('{Enter}{ArrowDown}')

    expect(screen.getByRole('menuitem', { name: /^Appearance:\s*System$/u })).toHaveFocus()
    await userEvent.keyboard('{Enter}')

    expect(screen.getByRole('menuitem', { name: /^Appearance:\s*Light$/u })).toHaveFocus()
    expect(document.documentElement).toHaveAttribute('data-theme', 'light')
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
