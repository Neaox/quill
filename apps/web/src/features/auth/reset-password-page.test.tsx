import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { renderApp } from '../../lib/api/render-app.tsx'
import { errorResponse, jsonResponse } from '../../lib/api/testing.ts'

describe('ResetPasswordPage', () => {
  it('requests a reset link', async () => {
    renderApp('/reset-password', {
      'POST /api/auth/password-reset/request': () => jsonResponse(202, {}),
    })
    await screen.findByRole('heading', { level: 1, name: 'Reset your password' })

    await userEvent.type(screen.getByLabelText('Email', { exact: false }), 'reader@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }))

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Check your email' }),
    ).toBeInTheDocument()
  })

  it('sets a new password with a token from the URL', async () => {
    renderApp('/reset-password?token=abc123', {
      'POST /api/auth/password-reset/confirm': () => jsonResponse(200, {}),
    })
    await screen.findByRole('heading', { level: 1, name: 'Choose a new password' })

    await userEvent.type(screen.getByLabelText('New password', { exact: false }), 'a-new-password')
    await userEvent.click(screen.getByRole('button', { name: 'Update password' }))

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Password updated' }),
    ).toBeInTheDocument()
  })

  it('shows the server error for an expired reset token', async () => {
    renderApp('/reset-password?token=expired', {
      'POST /api/auth/password-reset/confirm': () =>
        errorResponse(
          400,
          'invalid_or_expired',
          'That reset link is invalid, expired, or already used',
        ),
    })
    await screen.findByRole('heading', { level: 1, name: 'Choose a new password' })

    await userEvent.type(screen.getByLabelText('New password', { exact: false }), 'a-new-password')
    await userEvent.click(screen.getByRole('button', { name: 'Update password' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('invalid, expired, or already used')
  })
})
