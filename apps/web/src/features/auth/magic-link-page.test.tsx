import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { renderApp } from '../../lib/api/render-app.tsx'
import { errorResponse, jsonResponse } from '../../lib/api/testing.ts'

describe('MagicLinkPage', () => {
  it('requests a sign-in link and confirms without saying whether the account exists', async () => {
    renderApp('/magic-link', {
      'POST /api/auth/magic-link': () => jsonResponse(202, {}),
    })
    await screen.findByRole('heading', { level: 1, name: 'Email me a sign-in link' })

    await userEvent.type(screen.getByLabelText('Email', { exact: false }), 'reader@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Send link' }))

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Check your email' }),
    ).toBeInTheDocument()
  })

  it('consumes a token from the URL and signs the visitor in', async () => {
    renderApp('/magic-link?token=abc123', {
      'POST /api/auth/magic-link/consume': () => jsonResponse(200, { userId: 'user-1' }),
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

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Home' }, { timeout: 3000 }),
    ).toBeInTheDocument()
  })

  it('shows an error for an invalid or expired token', async () => {
    renderApp('/magic-link?token=expired', {
      'POST /api/auth/magic-link/consume': () =>
        errorResponse(
          400,
          'invalid_or_expired',
          'That sign-in link is invalid, expired, or already used',
        ),
    })

    expect(
      await screen.findByRole('heading', { level: 1, name: "This link didn't work" }),
    ).toBeInTheDocument()
    expect(screen.getByText(/invalid, expired, or already used/)).toBeInTheDocument()
  })
})
