import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { renderApp } from '../../lib/api/render-app.tsx'
import { jsonResponse } from '../../lib/api/testing.ts'
import {
  admin,
  NEXT_REVISION,
  readOrganisation,
  themeReport,
} from '../settings/settings-fixtures.ts'

/**
 * The organisation's theme, worn by the application (ADR-028, "Delivery").
 *
 * jsdom loads no stylesheet, so each test says when one has "arrived" by
 * dispatching the `load` a browser would.
 */

const BEFORE = {
  themeId: 'instrument',
  stylesheetHref: '/api/settings/organisation/theme.css?v=1',
  attributes: { 'data-rules': 'hairline' },
}
const AFTER = {
  themeId: 'grid',
  stylesheetHref: '/api/settings/organisation/theme.css?v=2',
  attributes: { 'data-rules': 'plain', 'data-align': 'start' },
}

const themeLinks = () => [...document.head.querySelectorAll('link[data-organisation-theme]')]

const loaded = async (href: string) => {
  const link = await waitFor(() => {
    const found = themeLinks().find((candidate) => candidate.getAttribute('href') === href)
    expect(found).toBeDefined()
    return found
  })
  link?.dispatchEvent(new Event('load'))
}

afterEach(() => {
  for (const link of themeLinks()) link.remove()
  for (const name of ['data-theme-id', 'data-rules', 'data-align']) {
    document.documentElement.removeAttribute(name)
  }
})

describe('the organisation’s theme', () => {
  it('is worn before anybody signs in, because the sign-in page renders with it too', async () => {
    renderApp('/sign-in', {
      'GET /api/settings/organisation/theme': () => jsonResponse(200, AFTER),
    })

    await loaded(AFTER.stylesheetHref)
    expect(document.documentElement).toHaveAttribute('data-theme-id', 'grid')
    expect(document.documentElement).toHaveAttribute('data-rules', 'plain')
    expect(document.documentElement).toHaveAttribute('data-align', 'start')
  })

  it('leaves the bundled identity in place when the theme cannot be read', async () => {
    renderApp('/sign-in', {})

    expect(await screen.findByRole('heading', { level: 1 })).toBeVisible()
    expect(themeLinks()).toEqual([])
    expect(document.documentElement).not.toHaveAttribute('data-theme-id')
  })

  it('changes on every screen as soon as an administrator saves one, without a reload', async () => {
    let summary = BEFORE
    renderApp('/admin/settings/theme', {
      'GET /api/me': admin,
      'GET /api/settings/organisation': readOrganisation(),
      'GET /api/settings/organisation/theme': () => jsonResponse(200, summary),
      'PUT /api/settings/organisation': async (request) => {
        const body = (await request.json()) as Record<string, unknown>
        summary = AFTER
        return jsonResponse(200, {
          revision: NEXT_REVISION,
          settings: body['settings'],
          report: themeReport(),
        })
      },
    })

    await loaded(BEFORE.stylesheetHref)
    expect(document.documentElement).toHaveAttribute('data-theme-id', 'instrument')

    await userEvent.click(await screen.findByRole('button', { name: 'Grid' }))
    await userEvent.click(screen.getByRole('tab', { name: 'Sliders' }))
    fireEvent.change(screen.getByLabelText('Colour'), { target: { value: '150' } })
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await loaded(AFTER.stylesheetHref)
    expect(document.documentElement).toHaveAttribute('data-theme-id', 'grid')
    expect(themeLinks().map((link) => link.getAttribute('href'))).toEqual([AFTER.stylesheetHref])
  })
})
