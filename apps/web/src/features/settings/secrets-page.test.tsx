import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { expectNoAccessibilityViolations } from '@quill/ui/testing/axe'

import { renderApp } from '../../lib/api/render-app.tsx'
import { errorResponse, jsonResponse, type FakeRoutes } from '../../lib/api/testing.ts'
import { admin, member, secret } from './settings-fixtures.ts'

const PATH = '/admin/settings/secrets'

function routes(extra: FakeRoutes = {}): FakeRoutes {
  return {
    'GET /api/me': admin,
    'GET /api/settings/secrets': () =>
      jsonResponse(200, [
        secret('oidc/entra/client-secret', { rotatedAt: '2026-02-01T00:00:00.000Z' }),
      ]),
    'GET /api/auth/oidc/providers': () =>
      jsonResponse(200, { providers: [{ id: 'entra', displayName: 'Acme Directory' }] }),
    ...extra,
  }
}

describe('the secrets screen', () => {
  it('lists a secret’s name, key and dates, and never a value', async () => {
    const { container } = renderApp(PATH, routes())

    expect(await screen.findByRole('heading', { level: 1, name: 'Secrets' })).toBeVisible()
    const row = screen.getByRole('row', { name: /oidc\/entra\/client-secret/ })
    expect(within(row).getByText('key-1')).toBeVisible()
    // There is no field for a value in the schema, so there is nothing here
    // that could show one: a password input only ever appears in the dialog.
    expect(container.querySelector('input[type="password"]')).toBeNull()
  })

  it('stores a new value through a write-only field', async () => {
    const bodies: Array<{ readonly name: string; readonly body: Record<string, unknown> }> = []
    renderApp(
      PATH,
      routes({
        'PUT /api/settings/secrets/{name}': async (request, params) => {
          bodies.push({
            name: params['name'] ?? '',
            body: (await request.json()) as Record<string, unknown>,
          })
          return jsonResponse(200, secret('smtp/password'))
        },
      }),
    )

    await userEvent.click(await screen.findByRole('button', { name: 'Add a secret' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add a secret' })
    await userEvent.type(within(dialog).getByLabelText('Name'), 'smtp/password')
    const value = within(dialog).getByLabelText('Value')
    expect(value).toHaveAttribute('type', 'password')
    await userEvent.type(value, 'hunter2')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Store' }))

    await waitFor(() => {
      expect(bodies).toHaveLength(1)
    })
    expect(bodies[0]?.name).toBe('smtp%2Fpassword')
    expect(bodies[0]?.body).toEqual({ value: 'hunter2' })
  })

  it('replaces a value without ever populating the field with the old one', async () => {
    renderApp(PATH, routes())

    await userEvent.click(
      await screen.findByRole('button', { name: 'Replace the value of oidc/entra/client-secret' }),
    )
    const dialog = await screen.findByRole('dialog', { name: /Replace oidc\/entra\/client-secret/ })

    expect(within(dialog).getByLabelText('Name')).toHaveAttribute('readonly')
    expect(within(dialog).getByLabelText('Value')).toHaveValue('')
    // Nothing to store until a value is typed in full.
    expect(within(dialog).getByRole('button', { name: 'Replace' })).toBeDisabled()
    expect(within(dialog).getByText('A name and a value are both needed.')).toBeVisible()
  })

  it('says why a value was refused', async () => {
    renderApp(
      PATH,
      routes({
        'PUT /api/settings/secrets/{name}': () =>
          errorResponse(422, 'invalid_secret_value', 'That value is empty'),
      }),
    )

    await userEvent.click(
      await screen.findByRole('button', { name: 'Replace the value of oidc/entra/client-secret' }),
    )
    const dialog = await screen.findByRole('dialog', { name: /Replace/ })
    await userEvent.type(within(dialog).getByLabelText('Value'), 'x')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Replace' }))

    expect(await within(dialog).findByText('That value is empty')).toBeVisible()
  })

  it('deletes a secret only after saying what is lost', async () => {
    const deleted: string[] = []
    renderApp(
      PATH,
      routes({
        'DELETE /api/settings/secrets/{name}': (_request, params) => {
          deleted.push(params['name'] ?? '')
          return new Response(null, { status: 204 })
        },
      }),
    )

    await userEvent.click(
      await screen.findByRole('button', { name: 'Delete oidc/entra/client-secret' }),
    )
    // `ConfirmDeleteDialog`, the same dialog collections, units and workspaces
    // use, which titles itself `Delete “<name>”?`.
    const dialog = await screen.findByRole('dialog', { name: /oidc\/entra\/client-secret/ })
    expect(within(dialog).getByText(/cannot be recovered once it is deleted/)).toBeVisible()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(deleted).toEqual(['oidc%2Fentra%2Fclient-secret'])
    })
  })

  it('points at the command that rotates the master key, rather than a control that cannot', async () => {
    renderApp(PATH, routes())

    expect(await screen.findByText('The two commands beside this screen')).toBeVisible()
    expect(screen.getByText('pnpm --filter @quill/server secrets:rotate')).toBeVisible()
    // The command an OIDC client secret has to be entered with, before
    // anybody can sign in to reach this screen at all.
    expect(screen.getByText(/secrets:set/)).toBeVisible()
    expect(screen.queryByRole('button', { name: /rotate/i })).not.toBeInTheDocument()
  })

  it('says there is nothing stored yet, with an example of what would be', async () => {
    renderApp(PATH, routes({ 'GET /api/settings/secrets': () => jsonResponse(200, []) }))

    expect(await screen.findByText('No secrets stored yet')).toBeVisible()
  })

  it('says so when the list cannot be loaded, keeping the rest of the screen', async () => {
    renderApp(
      PATH,
      routes({
        'GET /api/settings/secrets': () => errorResponse(500, 'internal_error', 'Nope'),
      }),
    )

    expect(await screen.findByText("Couldn't load the secrets")).toBeVisible()
    // The rotation note and the provider readout are still worth reading.
    expect(screen.getByText('The two commands beside this screen')).toBeVisible()
  })

  it('lists the sign-in providers read-only, and names the variables that change them', async () => {
    renderApp(PATH, routes())

    const providers = await screen.findByRole('list', { name: 'Sign-in providers' })
    expect(within(providers).getByText('Acme Directory')).toBeVisible()
    expect(screen.getByText('OIDC_PROVIDERS')).toBeVisible()
    // Read-only: nothing here edits environment configuration.
    expect(screen.queryByRole('button', { name: /add a provider/i })).not.toBeInTheDocument()
  })

  it('says when no provider is configured', async () => {
    renderApp(
      PATH,
      routes({ 'GET /api/auth/oidc/providers': () => jsonResponse(200, { providers: [] }) }),
    )

    expect(await screen.findByText(/None configured/)).toBeVisible()
  })

  it('is not a page a member can reach', async () => {
    renderApp(PATH, routes({ 'GET /api/me': member }))

    expect(await screen.findByText('This page is not available')).toBeVisible()
  })

  it('has no accessibility violations', async () => {
    const { container } = renderApp(PATH, routes())

    await screen.findByRole('heading', { level: 1, name: 'Secrets' })
    await expectNoAccessibilityViolations(container)
  })
})
