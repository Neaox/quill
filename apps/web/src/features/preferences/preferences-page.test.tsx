import { BRAND } from '@quill/brand'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { toast } from '@quill/ui'
import { expectNoAccessibilityViolations } from '@quill/ui/testing/axe'

import { renderApp } from '../../lib/api/render-app.tsx'
import { errorResponse, jsonResponse, type FakeRoutes } from '../../lib/api/testing.ts'
import { member } from '../settings/settings-fixtures.ts'

const PATH = '/preferences'

function routes(extra: FakeRoutes = {}): FakeRoutes {
  return {
    'GET /api/me': member,
    'GET /api/me/preferences': () => jsonResponse(200, { animatedImages: 'brief' }),
    ...extra,
  }
}

afterEach(() => {
  document.documentElement.removeAttribute('data-animated-images')
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('the preferences page', () => {
  it('offers link previews on hover, on until it is turned off, and remembers the choice in this browser', async () => {
    const user = userEvent.setup()
    renderApp(PATH, routes())

    const group = await screen.findByRole('group', { name: 'Link previews on hover' })
    expect(group).toHaveAccessibleDescription(/this browser only/)
    expect(screen.getByRole('radio', { name: 'Show' })).toBeChecked()

    await user.click(screen.getByRole('radio', { name: 'Don’t show' }))

    expect(screen.getByRole('radio', { name: 'Don’t show' })).toBeChecked()
    expect(localStorage.getItem(`${BRAND.slug}.link-peek`)).toBe('off')
  })

  it('offers the three ways animated images can play, with the one in force chosen', async () => {
    const { container } = renderApp(PATH, routes())

    expect(await screen.findByRole('heading', { level: 1, name: 'Preferences' })).toBeVisible()
    const group = await screen.findByRole('group', { name: 'Animated images' })
    expect(group).toHaveAccessibleDescription(/reduced motion, you always see a still image/)
    expect(screen.getByRole('radio', { name: 'Play briefly' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Play on hover only' })).not.toBeChecked()
    expect(screen.getByRole('radio', { name: 'Never' })).not.toBeChecked()
    await expectNoAccessibilityViolations(container)
  })

  it('saves a choice as it is made, says so, and applies it to the page', async () => {
    const bodies: unknown[] = []
    let stored = 'brief'
    renderApp(
      PATH,
      routes({
        'GET /api/me/preferences': () => jsonResponse(200, { animatedImages: stored }),
        'PUT /api/me/preferences': async (request) => {
          const body: unknown = await request.json()
          bodies.push(body)
          stored = 'never'
          return jsonResponse(200, { animatedImages: 'never' })
        },
      }),
    )

    await userEvent.click(await screen.findByRole('radio', { name: 'Never' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Saved')
    expect(bodies).toEqual([{ animatedImages: 'never' }])
    expect(screen.getByRole('radio', { name: 'Never' })).toBeChecked()
    await waitFor(() => {
      expect(document.documentElement).toHaveAttribute('data-animated-images', 'never')
    })
    expect(localStorage.getItem('animated-images-preference')).toBe('never')
  })

  it('says when a choice was not saved, and shows what is still in force', async () => {
    // The toast host is the app shell's, which this render does not mount.
    const danger = vi.spyOn(toast, 'danger')
    renderApp(
      PATH,
      routes({
        'PUT /api/me/preferences': () => errorResponse(500, 'internal', 'Something broke'),
      }),
    )

    await userEvent.click(await screen.findByRole('radio', { name: 'Play on hover only' }))

    await waitFor(() => {
      expect(danger).toHaveBeenCalledWith('Your preference wasn’t saved', {
        description: 'Nothing changed. Choose again to retry.',
      })
    })
    expect(screen.getByRole('radio', { name: 'Play briefly' })).toBeChecked()
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('says when the preferences could not be loaded', async () => {
    renderApp(
      PATH,
      routes({
        'GET /api/me/preferences': () => errorResponse(500, 'internal', 'Something broke'),
      }),
    )

    expect(await screen.findByText(/Couldn’t load your preferences/)).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Animated images' })).not.toBeInTheDocument()
  })
})
