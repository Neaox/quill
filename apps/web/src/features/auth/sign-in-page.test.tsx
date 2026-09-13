import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { BRAND } from '@quill/brand'
import { expectNoAccessibilityViolations } from '@quill/ui/testing/axe'

import { jsonResponse, errorResponse } from '../../lib/api/testing.ts'
import { renderApp } from '../../lib/api/render-app.tsx'

const providers = () =>
  jsonResponse(200, {
    providers: [
      { id: 'entra', displayName: 'Microsoft' },
      { id: 'google', displayName: 'Google' },
    ],
  })

async function fillAndSubmit(email: string, password: string) {
  await userEvent.type(screen.getByLabelText('Email', { exact: false }), email)
  await userEvent.type(screen.getByLabelText('Password', { exact: false }), password)
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
}

describe('SignInPage', () => {
  it('signs in and returns to the path that was being asked for', async () => {
    renderApp('/sign-in?redirect=%2Fdesign', {
      'POST /api/auth/sign-in': () => jsonResponse(200, { userId: 'user-1' }),
    })
    await screen.findByRole('heading', { level: 1, name: 'Sign in' })

    await fillAndSubmit('reader@example.com', 'correct horse battery staple')

    await waitFor(async () => {
      expect(
        await screen.findByRole('heading', { level: 1, name: 'The design system' }),
      ).toBeInTheDocument()
    })
  })

  it('goes to the home page when there is no return path to preserve', async () => {
    renderApp('/sign-in', {
      'POST /api/auth/sign-in': () => jsonResponse(200, { userId: 'user-1' }),
      'GET /api/me': () =>
        jsonResponse(200, {
          id: 'user-1',
          email: 'reader@example.com',
          displayName: 'Reader',
          emailVerified: true,
          isInstanceAdmin: false,
        }),
      'GET /api/workspaces': () =>
        jsonResponse(200, [
          {
            id: 'ws-1',
            unitId: 'unit-1',
            name: 'Engineering',
            slug: 'engineering',
            createdAt: '2026-01-01T00:00:00.000Z',
            unit: { id: 'unit-1', name: 'Acme', path: ['Acme'] },
          },
          {
            id: 'ws-2',
            unitId: 'unit-1',
            name: 'Product',
            slug: 'product',
            createdAt: '2026-01-01T00:00:00.000Z',
            unit: { id: 'unit-1', name: 'Acme', path: ['Acme'] },
          },
        ]),
    })
    await screen.findByRole('heading', { level: 1, name: 'Sign in' })

    await fillAndSubmit('reader@example.com', 'correct horse battery staple')

    // The signed-in home, which lists the person's workspaces under its own
    // heading (docs/design/home.md).
    expect(await screen.findByRole('heading', { level: 1, name: 'Home' })).toBeInTheDocument()
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Your workspaces' }),
    ).toBeInTheDocument()
  })

  it('shows the server error and stays on the page when credentials are wrong', async () => {
    renderApp('/sign-in', {
      'POST /api/auth/sign-in': () =>
        errorResponse(401, 'invalid_credentials', 'Incorrect email or password'),
    })
    await screen.findByRole('heading', { level: 1, name: 'Sign in' })

    await fillAndSubmit('reader@example.com', 'wrong password')

    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect email or password')
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument()
  })

  it('names the product above the card', async () => {
    renderApp('/sign-in')
    expect(await screen.findByText(BRAND.name)).toBeInTheDocument()
  })

  /**
   * Single sign-on (ADR-011). The list is fetched before anybody is signed
   * in, so a page with no providers — and a page whose provider list cannot
   * be read at all — must look exactly like the page always did.
   */
  describe('with identity providers configured', () => {
    it('offers one link per provider, above the password form', async () => {
      renderApp('/sign-in', { 'GET /api/auth/oidc/providers': providers })
      await screen.findByRole('heading', { level: 1, name: 'Sign in' })

      const microsoft = await screen.findByRole('link', { name: 'Continue with Microsoft' })
      const google = screen.getByRole('link', { name: 'Continue with Google' })

      // Links, not buttons: coming back from a provider is a top-level
      // navigation, which a fetch can never be.
      expect(microsoft).toHaveAttribute('href', '/api/auth/oidc/entra/start')
      expect(google).toHaveAttribute('href', '/api/auth/oidc/google/start')
      expect(
        microsoft.compareDocumentPosition(screen.getByLabelText('Email', { exact: false })) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
    })

    it('carries the return path through the provider round trip', async () => {
      renderApp('/sign-in?redirect=%2Fw%2Fengineering', {
        'GET /api/auth/oidc/providers': providers,
      })

      expect(await screen.findByRole('link', { name: 'Continue with Microsoft' })).toHaveAttribute(
        'href',
        '/api/auth/oidc/entra/start?redirect=%2Fw%2Fengineering',
      )
    })

    it('says a single sign-on failed, without saying why', async () => {
      renderApp('/sign-in?error=sso', { 'GET /api/auth/oidc/providers': providers })

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent('That sign-in could not be completed')
      // Nothing about accounts, addresses, or which check refused it.
      expect(alert.textContent).not.toMatch(/account|email address|token|state/i)
    })

    it('has no axe violations', async () => {
      const { container } = renderApp('/sign-in?error=sso', {
        'GET /api/auth/oidc/providers': providers,
      })
      await screen.findByRole('link', { name: 'Continue with Microsoft' })

      await expectNoAccessibilityViolations(container)
    })
  })

  it('shows only the password form when the instance has no providers', async () => {
    renderApp('/sign-in', {
      'GET /api/auth/oidc/providers': () => jsonResponse(200, { providers: [] }),
    })
    await screen.findByRole('heading', { level: 1, name: 'Sign in' })

    expect(screen.queryByRole('link', { name: /^Continue with/ })).not.toBeInTheDocument()
  })

  it('shows only the password form when the provider list cannot be read', async () => {
    // No stub for the providers route at all: the fake client answers 404.
    renderApp('/sign-in')
    await screen.findByRole('heading', { level: 1, name: 'Sign in' })

    expect(screen.queryByRole('link', { name: /^Continue with/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
  })
})
