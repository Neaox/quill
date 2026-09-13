import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { renderApp } from '../../lib/api/render-app.tsx'
import { errorResponse, jsonResponse, type FakeRoutes } from '../../lib/api/testing.ts'
import {
  admin,
  NEXT_REVISION,
  organisationSettings,
  REVISION,
  themeReport,
} from './settings-fixtures.ts'

const PATH = '/admin/settings/organisation'
const THEIR_REVISION = 'c'.repeat(40)

/**
 * The revision a save compares against.
 *
 * This is the one thing on these screens whose failure is silent: a write that
 * states the wrong `expectedRevision` is *accepted*, and the administrator it
 * overwrote is told nothing. So the rule it rests on — the revision belongs to
 * the draft, and only a named action moves it — is pinned here on its own
 * rather than as a detail of a screen's test.
 */
describe('the revision a settings form saves with', () => {
  /**
   * The sequence that used to defeat the compare-and-swap: the query refetches
   * while the form is open — on window focus, by default — and the revision the
   * next save quotes becomes the one *somebody else* just wrote. The draft
   * holds its own, so the save still quotes the document this person started
   * from and the server still refuses it.
   */
  it('is the one the draft was loaded at, even after the cache has moved on', async () => {
    const bodies: Array<Record<string, unknown>> = []
    let served = { revision: REVISION, settings: organisationSettings() }

    const { queryClient } = renderApp(PATH, {
      'GET /api/me': admin,
      'GET /api/settings/organisation': () => jsonResponse(200, served),
      'PUT /api/settings/organisation': async (request) => {
        const body = (await request.json()) as Record<string, unknown>
        bodies.push(body)
        return errorResponse(409, 'settings_conflict', 'Somebody else changed these settings', {
          revision: THEIR_REVISION,
        })
      },
    })

    const name = await screen.findByLabelText('Organisation name')
    await userEvent.clear(name)
    await userEvent.type(name, 'Mine')

    // Somebody else saves, and this tab refetches — the ordinary consequence of
    // alt-tabbing away and back.
    served = {
      revision: THEIR_REVISION,
      settings: organisationSettings({ name: 'Theirs' }),
    }
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['organisation-settings'] })
    })
    // The form is untouched by the refetch: it is a draft, not a view.
    expect(screen.getByLabelText('Organisation name')).toHaveValue('Mine')

    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(bodies).toHaveLength(1)
    })
    // The revision the draft was forked from, not the one the cache now holds.
    expect(bodies[0]).toMatchObject({ expectedRevision: REVISION })
    expect(
      await screen.findByText(/Somebody else changed these organisation settings/),
    ).toBeVisible()
  })

  /**
   * Overwriting somebody is a decision, so it is a button: the draft keeps the
   * edits and takes the server's revision, and only then is the next save
   * accepted. Before this, the same outcome fell out of the cache having moved
   * underneath — the same result, reached without anybody choosing it.
   */
  it('moves to the server’s only when somebody says to replace theirs', async () => {
    const bodies: Array<Record<string, unknown>> = []
    let served = { revision: REVISION, settings: organisationSettings() }
    let refuse = true

    renderApp(PATH, {
      'GET /api/me': admin,
      'GET /api/settings/organisation': () => jsonResponse(200, served),
      'PUT /api/settings/organisation': async (request) => {
        const body = (await request.json()) as Record<string, unknown>
        bodies.push(body)
        if (refuse) {
          refuse = false
          served = { revision: THEIR_REVISION, settings: organisationSettings({ name: 'Theirs' }) }
          return errorResponse(409, 'settings_conflict', 'Somebody else changed these settings', {
            revision: THEIR_REVISION,
          })
        }
        return jsonResponse(200, {
          revision: NEXT_REVISION,
          settings: body['settings'],
          report: themeReport(),
        })
      },
    })

    const name = await screen.findByLabelText('Organisation name')
    await userEvent.clear(name)
    await userEvent.type(name, 'Mine')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await screen.findByText(/Somebody else changed these organisation settings/)
    await userEvent.click(screen.getByRole('button', { name: 'Replace theirs with mine' }))

    // The edits survive the decision; only the base revision moved.
    expect(screen.getByLabelText('Organisation name')).toHaveValue('Mine')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(bodies).toHaveLength(2)
    })
    expect(bodies[1]).toMatchObject({ expectedRevision: THEIR_REVISION })
    expect(bodies[1]?.['settings']).toMatchObject({ name: 'Mine' })
  })

  it('is the server’s, with their values, when somebody loads their version', async () => {
    const bodies: Array<Record<string, unknown>> = []
    let served = { revision: REVISION, settings: organisationSettings() }
    let refuse = true

    renderApp(PATH, {
      'GET /api/me': admin,
      'GET /api/settings/organisation': () => jsonResponse(200, served),
      'PUT /api/settings/organisation': async (request) => {
        const body = (await request.json()) as Record<string, unknown>
        bodies.push(body)
        if (refuse) {
          refuse = false
          served = { revision: THEIR_REVISION, settings: organisationSettings({ name: 'Theirs' }) }
          return errorResponse(409, 'settings_conflict', 'Somebody else changed these settings', {
            revision: THEIR_REVISION,
          })
        }
        return jsonResponse(200, {
          revision: NEXT_REVISION,
          settings: body['settings'],
          report: themeReport(),
        })
      },
    })

    const name = await screen.findByLabelText('Organisation name')
    await userEvent.clear(name)
    await userEvent.type(name, 'Mine')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await screen.findByText(/Somebody else changed these organisation settings/)
    await userEvent.click(screen.getByRole('button', { name: 'Load their version' }))

    expect(screen.getByLabelText('Organisation name')).toHaveValue('Theirs')
    // Nothing to save: the form and the server agree again.
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  /** A successful save re-bases the draft, so the *next* save is not a conflict. */
  it('becomes the saved revision after a save, so a second save is accepted', async () => {
    const bodies: Array<Record<string, unknown>> = []
    renderApp(PATH, {
      'GET /api/me': admin,
      'GET /api/settings/organisation': () =>
        jsonResponse(200, { revision: REVISION, settings: organisationSettings() }),
      'PUT /api/settings/organisation': async (request) => {
        const body = (await request.json()) as Record<string, unknown>
        bodies.push(body)
        return jsonResponse(200, {
          revision: NEXT_REVISION,
          settings: body['settings'],
          report: themeReport(),
        })
      },
    })

    const name = await screen.findByLabelText('Organisation name')
    await userEvent.type(name, ' One')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(bodies).toHaveLength(1)
    })

    await userEvent.type(screen.getByLabelText('Organisation name'), ' Two')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(bodies).toHaveLength(2)
    })

    expect(bodies[0]).toMatchObject({ expectedRevision: REVISION })
    expect(bodies[1]).toMatchObject({ expectedRevision: NEXT_REVISION })
  })

  /** ADR-034's justification for files is "an author, a change note and a history". */
  it('carries a change note, so a revision list is legible', async () => {
    const bodies: Array<Record<string, unknown>> = []
    renderApp(PATH, {
      'GET /api/me': admin,
      'GET /api/settings/organisation': () =>
        jsonResponse(200, { revision: REVISION, settings: organisationSettings() }),
      'PUT /api/settings/organisation': async (request) => {
        const body = (await request.json()) as Record<string, unknown>
        bodies.push(body)
        return jsonResponse(200, {
          revision: NEXT_REVISION,
          settings: body['settings'],
          report: themeReport(),
        })
      },
    })

    await userEvent.type(await screen.findByLabelText('Organisation name'), '!')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(bodies).toHaveLength(1)
    })
    expect(bodies[0]).toMatchObject({ changeNote: 'Organisation' })
  })
})

/**
 * A refusal is one event, so it is said once. It used to be said twice: the
 * state the screen designed for it, and an assertive `role="alert"` repeating
 * the same sentence in the register `docs/design/feedback.md` reserves for a
 * failure somebody must act on.
 */
const refusingRoutes = (put: FakeRoutes[string]): FakeRoutes => ({
  'GET /api/me': admin,
  'GET /api/settings/organisation': () =>
    jsonResponse(200, { revision: REVISION, settings: organisationSettings() }),
  'PUT /api/settings/organisation': put,
})

describe('a refused save', () => {
  it('renders the conflict state and no alert beside it', async () => {
    renderApp(
      PATH,
      refusingRoutes(() =>
        errorResponse(409, 'settings_conflict', 'Somebody else changed these settings', {
          revision: THEIR_REVISION,
        }),
      ),
    )

    await userEvent.type(await screen.findByLabelText('Organisation name'), '!')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await screen.findByText(/Somebody else changed these organisation settings/)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('renders the schema issues and no alert beside them', async () => {
    renderApp(
      PATH,
      refusingRoutes(() =>
        errorResponse(422, 'invalid_settings', 'These settings are not valid', {
          issues: [{ path: '/name', message: 'must be shorter', rule: 'maxLength' }],
        }),
      ),
    )

    await userEvent.type(await screen.findByLabelText('Organisation name'), '!')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText(/must be shorter/)).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('falls back to one alert for a failure it has no state for', async () => {
    renderApp(
      PATH,
      refusingRoutes(() => errorResponse(500, 'internal_error', 'Something went wrong')),
    )

    await userEvent.type(await screen.findByLabelText('Organisation name'), '!')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    // The one register left: unexpected, and nothing on screen explains it.
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong')
  })
})
