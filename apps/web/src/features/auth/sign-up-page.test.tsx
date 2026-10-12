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

    expect(await screen.findByRole('alert')).toHaveTextContent('Use at least 12 characters.')
  })

  it('holds a password to the length the server does, not a shorter one', async () => {
    let sent = 0
    renderApp('/sign-up', {
      'POST /api/auth/sign-up': () => {
        sent += 1
        return jsonResponse(201, { userId: 'user-1' })
      },
    })
    await screen.findByRole('heading', { level: 1, name: 'Create your account' })

    await userEvent.type(screen.getByLabelText('Name', { exact: false }), 'Reader')
    await userEvent.type(screen.getByLabelText('Email', { exact: false }), 'reader@example.com')
    await userEvent.type(screen.getByLabelText('Password', { exact: false }), '12345678901')
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Use at least 12 characters.')
    expect(sent).toBe(0)
  })

  it('asks for what is missing, field by field, and sends nothing', async () => {
    let sent = 0
    renderApp('/sign-up', {
      'POST /api/auth/sign-up': () => {
        sent += 1
        return jsonResponse(201, { userId: 'user-1' })
      },
    })
    await screen.findByRole('heading', { level: 1, name: 'Create your account' })

    await userEvent.click(screen.getByRole('button', { name: 'Create account' }))

    expect(screen.getByLabelText('Name', { exact: false })).toHaveAccessibleDescription(
      'Enter your name.',
    )
    expect(screen.getByLabelText('Email', { exact: false })).toHaveAccessibleDescription(
      'Enter your email address.',
    )
    expect(screen.getByLabelText('Password', { exact: false })).toHaveAccessibleDescription(
      /Choose a password./,
    )
    expect(screen.getByLabelText('Name', { exact: false })).toHaveFocus()
    expect(sent).toBe(0)
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
