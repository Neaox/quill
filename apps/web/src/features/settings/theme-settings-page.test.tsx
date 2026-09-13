import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { expectNoAccessibilityViolations } from '@quill/ui/testing/axe'

import { renderApp } from '../../lib/api/render-app.tsx'
import { jsonResponse, type FakeRoutes } from '../../lib/api/testing.ts'
import {
  admin,
  NEXT_REVISION,
  readOrganisation,
  REVISION,
  themeReport,
} from './settings-fixtures.ts'

const PATH = '/admin/settings/theme'

function routes(extra: FakeRoutes = {}): FakeRoutes {
  return {
    'GET /api/me': admin,
    'GET /api/settings/organisation': readOrganisation(),
    ...extra,
  }
}

function recordingPut(bodies: Array<Record<string, unknown>>) {
  return async (request: Request) => {
    const body = (await request.json()) as Record<string, unknown>
    bodies.push(body)
    return jsonResponse(200, {
      revision: NEXT_REVISION,
      settings: body['settings'],
      report: themeReport(),
    })
  }
}

/** The generated custom properties written onto one preview pane. */
function paneTokens(container: HTMLElement, scheme: 'light' | 'dark'): CSSStyleDeclaration {
  const pane = container.querySelector<HTMLElement>(`[data-scheme="${scheme}"]`)
  if (pane === null) throw new Error(`no ${scheme} preview pane`)
  return pane.style
}

describe('the theme editor', () => {
  it('paints the preview with the palettes the edited document generates', async () => {
    const { container } = renderApp(PATH, routes())

    await screen.findByRole('heading', { level: 1, name: 'Theme' })

    await waitFor(() => {
      expect(paneTokens(container, 'light').getPropertyValue('--palette-accent')).not.toBe('')
    })
    // Light and dark at once: the question is whether an accent works in
    // both, and a toggle would make that a memory test (ADR-028, step 3).
    expect(paneTokens(container, 'dark').getPropertyValue('--palette-background')).not.toBe(
      paneTokens(container, 'light').getPropertyValue('--palette-background'),
    )
  })

  it('regenerates the palettes when a lever moves, in this browser', async () => {
    const { container } = renderApp(PATH, routes())

    const hue = await screen.findByLabelText('Accent hue')
    const before = paneTokens(container, 'light').getPropertyValue('--palette-accent')

    fireEvent.change(hue, { target: { value: '200' } })

    await waitFor(() => {
      expect(paneTokens(container, 'light').getPropertyValue('--palette-accent')).not.toBe(before)
    })
    expect(screen.getByText('200°')).toBeVisible()
  })

  it('reports the doctor beside the form', async () => {
    renderApp(PATH, routes())

    expect(await screen.findByRole('list', { name: 'Theme doctor report' })).toBeVisible()
    expect(screen.getByText(/pass · .* adjusted · .* warn/)).toBeVisible()
  })

  it('forks the built-in the first time a lever moves, so the built-in stays as it shipped', async () => {
    const bodies: Array<Record<string, unknown>> = []
    renderApp(PATH, routes({ 'PUT /api/settings/organisation': recordingPut(bodies) }))

    const hue = await screen.findByLabelText('Accent hue')
    fireEvent.change(hue, { target: { value: '200' } })
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(bodies).toHaveLength(1)
    })
    const saved = bodies[0]?.['settings'] as {
      theme: { id: string; base: string; seeds: { accent: { hue: number } } }
    }
    expect(saved.theme.base).toBe('instrument')
    expect(saved.theme.id).not.toBe('instrument')
    expect(saved.theme.seeds.accent.hue).toBe(200)
    expect(bodies[0]).toMatchObject({ expectedRevision: REVISION })
  })

  it('starts from another built-in, and offers a reset back to it', async () => {
    renderApp(PATH, routes())

    await userEvent.click(await screen.findByRole('button', { name: 'Press' }))

    expect(screen.getByText(/Forked from Press/)).toBeVisible()
    const reset = screen.getByRole('button', { name: 'Reset to Press' })

    // A reset after a lever has moved puts the built-in's own value back.
    fireEvent.change(screen.getByLabelText('Accent hue'), { target: { value: '10' } })
    expect(screen.getByText('10°')).toBeVisible()
    await userEvent.click(reset)
    expect(screen.queryByText('10°')).not.toBeInTheDocument()
  })

  it('changes the reading face without touching the interface face', async () => {
    const bodies: Array<Record<string, unknown>> = []
    renderApp(PATH, routes({ 'PUT /api/settings/organisation': recordingPut(bodies) }))

    await userEvent.selectOptions(await screen.findByLabelText('Reading face'), 'newsreader')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(bodies).toHaveLength(1)
    })
    const saved = bodies[0]?.['settings'] as {
      theme: { type: { reading: { id: string }; interface: { id: string } } }
    }
    expect(saved.theme.type.reading.id).toBe('newsreader')
    expect(saved.theme.type.interface.id).toBe('ibm-plex-sans')
  })

  it('adds and removes a collection colour', async () => {
    renderApp(PATH, routes())

    await userEvent.type(await screen.findByLabelText('Collection name'), 'Runbooks')
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))

    expect(screen.getByLabelText('Runbooks hue')).toBeVisible()

    await userEvent.click(screen.getByRole('button', { name: 'Remove the colour for Runbooks' }))

    expect(screen.queryByLabelText('Runbooks hue')).not.toBeInTheDocument()
  })

  it('says what the guided flow is, without a control that would do nothing', async () => {
    renderApp(PATH, routes())

    expect(await screen.findByText('Setting this up for the first time?')).toBeVisible()
    expect(screen.queryByRole('button', { name: /guided/i })).not.toBeInTheDocument()
  })

  it('has no accessibility violations', async () => {
    const { container } = renderApp(PATH, routes())

    await screen.findByRole('heading', { level: 1, name: 'Theme' })
    await expectNoAccessibilityViolations(container)
  })
})
