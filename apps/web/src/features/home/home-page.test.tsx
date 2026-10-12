import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { BRAND } from '@quill/brand'
import { expectNoAccessibilityViolations } from '@quill/ui/testing/axe'

import { renderApp } from '../../lib/api/render-app.tsx'
import {
  errorResponse,
  jsonResponse,
  type FakeRouteHandler,
  type FakeRoutes,
} from '../../lib/api/testing.ts'
import { greetingFor } from './home-page.tsx'
import { setupSteps } from './setup-checklist.tsx'

const me = {
  id: 'user-1',
  email: 'reader@example.com',
  displayName: 'Reader',
  emailVerified: true,
  isInstanceAdmin: false,
}

const admin = { ...me, id: 'user-0', displayName: 'Admin', isInstanceAdmin: true }

/** Only the name is read by the home page; the rest of the document is the settings screens'. */
const settings = (name: string) => ({ revision: null, settings: { name } })

const workspace = (id: string, name: string, unitId: string, path: readonly string[]) => ({
  id,
  unitId,
  name,
  slug: name.toLowerCase().replaceAll(' ', '-'),
  createdAt: '2026-01-01T00:00:00.000Z',
  unit: { id: unitId, name: path.at(-1) ?? '', path },
})

const document = (overrides: {
  id: string
  shortId: string
  title: string
  workspaceId: string
  headRevision: string | null
  updatedAt: string
}) => ({
  collectionId: 'col-1',
  parentId: null,
  slug: overrides.title.toLowerCase().replaceAll(' ', '-'),
  path: 'guides/page.md',
  status: overrides.headRevision === null ? 'draft' : 'published',
  templateId: null,
  templateVersion: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
})

const TWO_WORKSPACES = [
  workspace('ws-1', 'Engineering', 'unit-1', ['Acme']),
  workspace('ws-2', 'Platform docs', 'unit-2', ['Acme', 'Platform']),
]

const DRAFT = document({
  id: 'doc-draft',
  shortId: 'k7m3q9v2rt',
  title: 'Failover drill',
  workspaceId: 'ws-1',
  headRevision: null,
  updatedAt: '2026-03-02T00:00:00.000Z',
})

const PUBLISHED = document({
  id: 'doc-published',
  shortId: 'p4n8w2cx5b',
  title: 'Release notes',
  workspaceId: 'ws-2',
  headRevision: 'a'.repeat(40),
  updatedAt: '2026-03-01T00:00:00.000Z',
})

/** A draft in Engineering and a published document in Platform docs. */
const POPULATED: FakeRouteHandler = (_request, params) =>
  jsonResponse(200, params['workspaceId'] === 'ws-1' ? [DRAFT] : [PUBLISHED])

const EMPTY: FakeRouteHandler = () => jsonResponse(200, [])

function home(person: typeof me, documents: FakeRouteHandler, extra: FakeRoutes = {}) {
  return renderApp('/', {
    'GET /api/me': () => jsonResponse(200, person),
    'GET /api/workspaces': () => jsonResponse(200, TWO_WORKSPACES),
    'GET /api/workspaces/{workspaceId}/documents': documents,
    ...extra,
  })
}

afterEach(() => {
  localStorage.clear()
})

describe('the signed-in home', () => {
  it('sends a signed-out visit to sign-in', async () => {
    renderApp('/', {
      'GET /api/me': () => errorResponse(401, 'unauthenticated', 'Sign in required'),
    })

    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument()
  })

  it('opens the only workspace straight away instead of listing it', async () => {
    const { router } = renderApp('/', {
      'GET /api/me': () => jsonResponse(200, me),
      'GET /api/workspaces': () =>
        jsonResponse(200, [workspace('ws-1', 'Engineering', 'unit-1', ['Acme'])]),
      'GET /api/workspaces/{id}': () =>
        jsonResponse(200, workspace('ws-1', 'Engineering', 'unit-1', ['Acme'])),
      'GET /api/workspaces/{id}/tree': () => jsonResponse(200, { collections: [] }),
      'GET /api/workspaces/{workspaceId}/documents': EMPTY,
    })

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/w/ws-1')
    })
  })

  it('greets the person and offers search as the first thing to do', async () => {
    const { container } = home(me, EMPTY)

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: /^Good (morning|afternoon|evening), Reader$/,
      }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Search or jump to…' })).toBeInTheDocument()
    await screen.findByText(/Nothing has been published yet/)
    await expectNoAccessibilityViolations(container)
  })

  it('shows each workspace as a card with what is in it, and a way in', async () => {
    home(me, (_request, params) =>
      jsonResponse(
        200,
        params['workspaceId'] === 'ws-1'
          ? [DRAFT, { ...PUBLISHED, id: 'doc-2', workspaceId: 'ws-1' }]
          : [],
      ),
    )

    expect(await screen.findByRole('heading', { level: 2, name: 'Workspaces' })).toBeInTheDocument()
    const engineering = screen.getByRole('link', { name: /^Engineering/ })
    expect(engineering).toHaveAttribute('href', '/w/engineering')
    await waitFor(() => {
      expect(engineering).toHaveTextContent('2 documents')
    })
    expect(engineering).toHaveTextContent('1 draft')
    expect(engineering).toHaveTextContent('Updated')
    const platform = screen.getByRole('link', { name: /^Platform docs/ })
    expect(platform).toHaveAttribute('href', '/w/platform-docs')
    expect(platform).toHaveTextContent('Acme / Platform')
    expect(platform).toHaveTextContent('0 documents')
    expect(platform).not.toHaveTextContent('draft')
  })

  it('omits Continue writing, and says nothing is published yet, while there is nothing', async () => {
    home(me, EMPTY)

    expect(await screen.findByText(/Nothing has been published yet/)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /Continue writing/ })).not.toBeInTheDocument()
  })

  it('splits documents across workspaces into Continue writing and Recently updated', async () => {
    const { container } = home(me, POPULATED)

    expect(await screen.findByRole('heading', { name: 'Continue writing' })).toBeInTheDocument()
    // The address says what it points at (ADR-035): the workspace's slug, and
    // the document's title-slug with its stable key.
    const draft = screen.getByRole('link', { name: /Failover drill/ })
    expect(draft).toHaveAttribute('href', '/w/engineering/d/failover-drill-k7m3q9v2rt')
    // When, as a machine-readable date beside the words a person reads.
    expect(within(draft).getByText(/ago|yesterday|last/)).toHaveAttribute(
      'datetime',
      '2026-03-02T00:00:00.000Z',
    )
    expect(screen.getByRole('heading', { name: 'Recently updated' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Release notes/ })).toHaveAttribute(
      'href',
      '/w/platform-docs/d/release-notes-p4n8w2cx5b',
    )
    await expectNoAccessibilityViolations(container)
  })

  it('tells a person with no workspaces whom to ask', async () => {
    renderApp('/', {
      'GET /api/me': () => jsonResponse(200, me),
      'GET /api/workspaces': () => jsonResponse(200, []),
    })

    expect(await screen.findByText('No workspaces yet')).toBeInTheDocument()
  })

  it('never shows the checklist or the settings to somebody who could not act on them', async () => {
    renderApp('/', {
      'GET /api/me': () => jsonResponse(200, me),
      'GET /api/workspaces': () => jsonResponse(200, []),
    })

    await screen.findByText('No workspaces yet')
    expect(screen.queryByText('Set up your organisation')).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Organisation' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Organisation settings' })).not.toBeInTheDocument()
  })
})

describe('the administrator’s set-up checklist', () => {
  it('walks an administrator with nothing set up through the first unit', async () => {
    const { container } = renderApp('/', {
      'GET /api/me': () => jsonResponse(200, admin),
      'GET /api/workspaces': () => jsonResponse(200, []),
      'GET /api/units': () => jsonResponse(200, []),
      'GET /api/settings/organisation': () => jsonResponse(200, settings(BRAND.name)),
    })

    const checklist = await screen.findByRole('region', { name: 'Set up your organisation' })
    expect(within(checklist).getByText('0 of 3 done')).toBeInTheDocument()
    expect(
      await within(checklist).findByRole('button', { name: 'Create a unit' }),
    ).toBeInTheDocument()
    expect(within(checklist).getByRole('link', { name: 'Organisation settings' })).toHaveAttribute(
      'href',
      '/admin/settings/organisation',
    )
    expect(within(checklist).getByRole('link', { name: 'Theme' })).toHaveAttribute(
      'href',
      '/admin/settings/theme',
    )
    // The empty state points at the tree, not at a checklist that can be hidden.
    expect(
      within(screen.getByRole('group', { name: /No workspaces yet/ })).getByRole('link', {
        name: 'Units and workspaces',
      }),
    ).toHaveAttribute('href', '/admin/organisation')
    await expectNoAccessibilityViolations(container)
  })

  it('offers the next step, a workspace, once a unit exists', async () => {
    renderApp('/', {
      'GET /api/me': () => jsonResponse(200, admin),
      'GET /api/workspaces': () => jsonResponse(200, []),
      'GET /api/settings/organisation': () => jsonResponse(200, settings('Acme')),
      'GET /api/units': () =>
        jsonResponse(200, [
          {
            id: 'unit-1',
            parentId: null,
            name: 'Acme',
            slug: 'acme',
            label: 'company',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ]),
    })

    expect(await screen.findByRole('button', { name: 'Create a workspace' })).toBeInTheDocument()
    expect(screen.getByText('1 of 3 done')).toBeInTheDocument()
    // A finished step says so in words as well as with its tick.
    expect(screen.getByText('Name your organisation and choose its theme')).toHaveTextContent(
      '(done)',
    )
  })

  it('leaves itself out once everything on it is done, and keeps the way into settings', async () => {
    home(admin, POPULATED, {
      'GET /api/settings/organisation': () => jsonResponse(200, settings('Acme')),
    })

    await screen.findByRole('link', { name: /Release notes/ })
    expect(screen.queryByText('Set up your organisation')).not.toBeInTheDocument()
    // The way into the organisation's settings stays, done or not: every
    // destination the person menu offers, in its own section.
    const organisation = screen.getByRole('region', { name: 'Organisation' })
    expect(
      within(organisation)
        .getAllByRole('link')
        .map((link) => [link.textContent, link.getAttribute('href')]),
    ).toEqual([
      ['Organisation settings', '/admin/settings/organisation'],
      ['Theme', '/admin/settings/theme'],
      ['Labels and emoji', '/admin/settings/labels'],
      ['Layout', '/admin/settings/layout'],
      ['Secrets and sign-in', '/admin/settings/secrets'],
      ['Units and workspaces', '/admin/organisation'],
    ])
  })

  it('can be hidden, and stays hidden', async () => {
    const extra = {
      'GET /api/settings/organisation': () => jsonResponse(200, settings(BRAND.name)),
    }
    const first = home(admin, EMPTY, extra)

    const checklist = await screen.findByRole('region', { name: 'Set up your organisation' })
    await userEvent.click(within(checklist).getByRole('button', { name: 'Hide' }))
    expect(screen.queryByText('Set up your organisation')).not.toBeInTheDocument()

    first.unmount()
    home(admin, EMPTY, extra)
    await screen.findByRole('heading', { level: 2, name: /^Workspaces/ })
    expect(screen.queryByText('Set up your organisation')).not.toBeInTheDocument()
  })
})

describe('setupSteps', () => {
  it('answers each step from what the instance already says', () => {
    expect(
      setupSteps({ named: true, hasWorkspace: false, anyPublished: false }).map((step) => [
        step.id,
        step.done,
      ]),
    ).toEqual([
      ['identity', true],
      ['workspace', false],
      ['publish', false],
    ])
  })
})

describe('greetingFor', () => {
  it('follows the hour on the reader’s own clock', () => {
    expect(greetingFor(4)).toBe('Good evening')
    expect(greetingFor(5)).toBe('Good morning')
    expect(greetingFor(12)).toBe('Good afternoon')
    expect(greetingFor(18)).toBe('Good evening')
  })
})
