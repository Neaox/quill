import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { renderApp } from '../../lib/api/render-app.tsx'
import { errorResponse, jsonResponse } from '../../lib/api/testing.ts'

describe('VerifyEmailPage', () => {
  it('tells a visitor with no token to open the link on this device', async () => {
    renderApp('/verify-email')
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Check your email' }),
    ).toBeInTheDocument()
  })

  it('verifies the email for a valid token', async () => {
    renderApp('/verify-email?token=abc123', {
      'POST /api/auth/verify-email': () => jsonResponse(200, {}),
    })
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Email verified' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Continue' })).toHaveAttribute('href', '/')
  })

  it('shows an error for an invalid or expired verification token', async () => {
    renderApp('/verify-email?token=expired', {
      'POST /api/auth/verify-email': () =>
        errorResponse(
          400,
          'invalid_or_expired',
          'That verification link is invalid, expired, or already used',
        ),
    })
    expect(
      await screen.findByRole('heading', { level: 1, name: "This link didn't work" }),
    ).toBeInTheDocument()
  })
})
