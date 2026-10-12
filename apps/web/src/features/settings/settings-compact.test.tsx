import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { expectNoAccessibilityViolations } from '@quill/ui/testing/axe'

import { renderApp } from '../../lib/api/render-app.tsx'
import type { FakeRoutes } from '../../lib/api/testing.ts'
import { COMPACT_EDITOR_QUERY } from '../layout/use-media-query.ts'
import { admin, readOrganisation } from './settings-fixtures.ts'

function routes(): FakeRoutes {
  return {
    'GET /api/me': admin,
    'GET /api/settings/organisation': readOrganisation(),
  }
}

/** A window narrower than the compact breakpoint: only that query matches. */
function phoneMatchMedia(query: string): MediaQueryList {
  return {
    matches: query === COMPACT_EDITOR_QUERY,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }
}

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    value: phoneMatchMedia,
    configurable: true,
    writable: true,
  })
})

afterEach(() => {
  Reflect.deleteProperty(window, 'matchMedia')
})

describe('the theme editor on a phone', () => {
  it('moves the preview and Save into a bar at the bottom, not under the levers', async () => {
    const { container } = renderApp('/admin/settings/theme', routes())

    const bar = await screen.findByRole('region', { name: 'Theme actions' })
    expect(within(bar).getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(within(bar).getByText(/All \d+ checks pass|to check|adjusted/)).toBeVisible()
    // One Save, on the bar: not a second one hidden in the page's top bar.
    expect(screen.getAllByRole('button', { name: 'Save' })).toHaveLength(1)
    // No preview stacked in the page: it is behind the bar.
    expect(container.querySelector('[data-scheme]')).toBeNull()
    // The doctor's full report stays in the page, below the levers.
    expect(screen.getByRole('list', { name: 'Theme doctor report' })).toBeVisible()
  })

  it('opens the live preview of the edited theme in a sheet', async () => {
    renderApp('/admin/settings/theme', routes())

    const bar = await screen.findByRole('region', { name: 'Theme actions' })
    await userEvent.click(within(bar).getByRole('button', { name: 'Preview' }))

    const sheet = await screen.findByRole('dialog', { name: 'Preview' })
    await waitFor(() => {
      const pane = sheet.querySelector<HTMLElement>('[data-scheme="light"]')
      expect(pane?.style.getPropertyValue('--palette-accent')).not.toBe('')
    })
  })

  it('has no accessibility violations', async () => {
    const { container } = renderApp('/admin/settings/theme', routes())

    await screen.findByRole('region', { name: 'Theme actions' })
    await expectNoAccessibilityViolations(container)
  })
})

describe('the layout settings on a phone', () => {
  it('puts Save on the bar, with whether there is anything to save', async () => {
    renderApp('/admin/settings/layout', routes())

    const bar = await screen.findByRole('region', { name: 'Layout actions' })
    expect(within(bar).getByText('Nothing to save')).toBeVisible()
    expect(within(bar).getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(screen.getAllByRole('button', { name: 'Save' })).toHaveLength(1)
  })

  it('has no accessibility violations', async () => {
    const { container } = renderApp('/admin/settings/layout', routes())

    await screen.findByRole('region', { name: 'Layout actions' })
    await expectNoAccessibilityViolations(container)
  })
})
