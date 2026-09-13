import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { BRAND } from '@quill/brand'

import { jsonResponse, errorResponse } from '../../lib/api/testing.ts'
import { renderApp } from '../../lib/api/render-app.tsx'

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
})
