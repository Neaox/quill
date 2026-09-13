import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { renderApp } from '../../lib/api/render-app.tsx'
import { errorResponse, jsonResponse } from '../../lib/api/testing.ts'

describe('SignUpPage', () => {
  it('creates an account and replaces the form with a link to sign in', async () => {
    renderApp('/sign-up', {
      'POST /api/auth/sign-up': () => jsonResponse(201, { userId: 'user-1' }),
    })
    await screen.findByRole('heading', { level: 1, name: 'Create your account' })

    await userEvent.type(screen.getByLabelText('Name', { exact: false }), 'Reader')
    await userEvent.type(screen.getByLabelText('Email', { exact: false }), 'reader@example.com')
    await userEvent.type(
      screen.getByLabelText('Password', { exact: false }),
      'correct horse battery',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }))

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Account created' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/sign-in')
  })

  it('flags a short password before submitting, without calling the API', async () => {
    renderApp('/sign-up', {
      'POST /api/auth/sign-up': () => {
        throw new Error('should not be called')
      },
    })
    await screen.findByRole('heading', { level: 1, name: 'Create your account' })

    await userEvent.type(screen.getByLabelText('Name', { exact: false }), 'Reader')
    await userEvent.type(screen.getByLabelText('Email', { exact: false }), 'reader@example.com')
    await userEvent.type(screen.getByLabelText('Password', { exact: false }), 'short')
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('at least 8 characters')
  })

  it('shows the server error when the email is already taken', async () => {
    renderApp('/sign-up', {
      'POST /api/auth/sign-up': () =>
        errorResponse(409, 'email_taken', 'An account with that email already exists'),
    })
    await screen.findByRole('heading', { level: 1, name: 'Create your account' })

    await userEvent.type(screen.getByLabelText('Name', { exact: false }), 'Reader')
    await userEvent.type(screen.getByLabelText('Email', { exact: false }), 'reader@example.com')
    await userEvent.type(
      screen.getByLabelText('Password', { exact: false }),
      'correct horse battery',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('already exists')
  })
})
