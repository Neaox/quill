import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { BRAND } from '@quill/brand'
import { expectNoAccessibilityViolations } from '@quill/ui/testing/axe'

import { renderApp } from '../../lib/api/render-app.tsx'
import { errorResponse, jsonResponse, type FakeRoutes } from '../../lib/api/testing.ts'
import { greetingFor } from './home-page.tsx'
import { setupSteps } from './setup-checklist.tsx'
import { COLLAPSE_ABOVE, PREVIEW_COUNT } from './workspace-places.tsx'

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

const homeDocument = (overrides: {
  id: string
  shortId: string
  title: string
  workspaceId: string
  updatedAt: string
}) => ({ slug: overrides.title.toLowerCase().replaceAll(' ', '-'), ...overrides })

const TWO_WORKSPACES = [
  workspace('ws-1', 'Engineering', 'unit-1', ['Acme']),
  workspace('ws-2', 'Platform docs', 'unit-2', ['Acme', 'Platform']),
]

const DRAFT = homeDocument({
  id: 'doc-draft',
  shortId: 'k7m3q9v2rt',
  title: 'Failover drill',
  workspaceId: 'ws-1',
  updatedAt: '2026-03-02T00:00:00.000Z',
})

const PUBLISHED = homeDocument({
  id: 'doc-published',
  shortId: 'p4n8w2cx5b',
  title: 'Release notes',
  workspaceId: 'ws-2',
  updatedAt: '2026-03-01T00:00:00.000Z',
})

const stats = (
  workspaceId: string,
  documentCount: number,
  draftCount: number,
  updatedAt?: string,
  engagement = 0,
) => ({ workspaceId, documentCount, draftCount, updatedAt: updatedAt ?? null, engagement })

/** A draft in Engineering and a published document in Platform docs. */
const POPULATED = {
  stats: [stats('ws-1', 2, 1, '2026-03-02T00:00:00.000Z'), stats('ws-2', 0, 0)],
  drafts: { total: 1, items: [DRAFT] },
  recent: [PUBLISHED],
  anyPublished: true,
  scope: 'everywhere',
  hasHistory: false,
  jumpBackIn: [],
}

const NOTHING = {
  stats: [],
  drafts: { total: 0, items: [] },
  recent: [],
  anyPublished: false,
  scope: 'everywhere',
  hasHistory: false,
  jumpBackIn: [],
}

function home(
  person: typeof me,
  summary: unknown,
  extra: FakeRoutes = {},
  workspaces: readonly unknown[] = TWO_WORKSPACES,
) {
  return renderApp('/', {
    'GET /api/me': () => jsonResponse(200, person),
    'GET /api/workspaces': () => jsonResponse(200, workspaces),
    'GET /api/home': () => jsonResponse(200, summary),
    'GET /api/me/attention': () => jsonResponse(200, { items: [] }),
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
      'GET /api/home': () => jsonResponse(200, NOTHING),
    })

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/w/ws-1')
    })
  })

  it('greets the person and offers search as the first thing to do', async () => {
    const { container } = home(me, NOTHING)

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

  it('lists each workspace with what is in it and a way in, naming its unit when they differ', async () => {
    home(me, POPULATED)

    expect(await screen.findByRole('heading', { level: 2, name: 'Workspaces' })).toBeInTheDocument()
    const engineering = screen.getByRole('link', { name: /^Engineering/ })
    expect(engineering).toHaveAttribute('href', '/w/engineering')
    await waitFor(() => {
      expect(engineering).toHaveTextContent('2 documents')
    })
    expect(engineering).toHaveTextContent('1 draft')
    expect(within(engineering).getByText(/ago|just now|yesterday/)).toHaveAttribute('datetime')
    const platform = screen.getByRole('link', { name: /^Platform docs/ })
    expect(platform).toHaveAttribute('href', '/w/platform-docs')
    // Which unit holds it is said on the row: three workspaces under three
    // headings would be furniture.
    expect(platform).toHaveTextContent('Acme / Platform')
    expect(platform).toHaveTextContent('0 documents')
    expect(platform).not.toHaveTextContent('draft')
    expect(screen.queryByRole('searchbox', { name: 'Filter workspaces' })).not.toBeInTheDocument()
  })

  it('says nothing is published, and omits Continue writing, while there is nothing', async () => {
    home(me, NOTHING)

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

  it('puts what is waiting on the person first, each as a sentence that says what is asked', async () => {
    home(me, POPULATED, {
      'GET /api/me/attention': () =>
        jsonResponse(200, {
          items: [
            {
              kind: 'review-requested',
              requestId: 'r1',
              document: {
                id: 'doc-published',
                shortId: 'p4n8w2cx5b',
                title: 'Release notes',
                workspaceId: 'ws-2',
              },
              by: { id: 'u-ada', name: 'Ada' },
              at: '2026-03-02T00:00:00.000Z',
            },
            {
              kind: 'changes-requested',
              requestId: 'r2',
              document: {
                id: 'doc-draft',
                shortId: 'k7m3q9v2rt',
                title: 'Failover drill',
                workspaceId: 'ws-1',
              },
              by: { id: 'u-grace', name: 'Grace' },
              at: '2026-03-01T00:00:00.000Z',
            },
          ],
        }),
    })

    const attention = await screen.findByRole('region', { name: 'Needs your attention' })
    const items = within(attention).getAllByRole('link')
    expect(items[0]).toHaveTextContent('Ada asked you to review Release notes')
    expect(items[0]).toHaveAttribute('href', '/w/platform-docs/d/release-notes-p4n8w2cx5b')
    expect(items[1]).toHaveTextContent('Grace asked for changes to Failover drill')
    // First on the page, above the work they left unfinished.
    const headings = screen
      .getAllByRole('heading', { level: 2 })
      .map((heading) => heading.textContent)
    expect(headings.indexOf('Needs your attention')).toBeLessThan(
      headings.indexOf('Continue writing'),
    )
  })

  it('has no attention section when nothing is waiting', async () => {
    home(me, POPULATED)

    await screen.findByRole('heading', { name: 'Continue writing' })
    expect(screen.queryByRole('region', { name: 'Needs your attention' })).not.toBeInTheDocument()
  })

  it('offers a way back to what the person was just in', async () => {
    home(me, {
      ...POPULATED,
      jumpBackIn: [{ ...PUBLISHED, viewedAt: '2026-03-02T00:00:00.000Z' }],
    })

    const section = await screen.findByRole('region', { name: 'Jump back in' })
    expect(within(section).getByRole('link', { name: /Release notes/u })).toHaveAttribute(
      'href',
      '/w/platform-docs/d/release-notes-p4n8w2cx5b',
    )
  })

  it('lets a person with a history choose between their places and everywhere', async () => {
    const asked: (string | null)[] = []
    home(me, undefined, {
      'GET /api/home': (request) => {
        const scope = new URL(request.url).searchParams.get('scope')
        asked.push(scope)
        return jsonResponse(200, {
          ...POPULATED,
          hasHistory: true,
          scope: scope ?? 'mine',
          recent: scope === 'everywhere' ? [PUBLISHED] : [],
        })
      },
    })

    // Their places are quiet, and the page says so rather than going blank.
    expect(await screen.findByText('Nothing new in your places')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: 'Everywhere' }))

    expect(await screen.findByRole('link', { name: /Release notes/u })).toBeInTheDocument()
    expect(asked).toEqual([null, 'everywhere'])
  })

  it('does not offer the choice to somebody with no history of their own', async () => {
    home(me, POPULATED)

    await screen.findByRole('link', { name: /Release notes/u })
    expect(screen.queryByRole('radio', { name: 'Your places' })).not.toBeInTheDocument()
  })

  it('says how many drafts there are when it shows only some of them', async () => {
    home(me, { ...POPULATED, drafts: { total: 23, items: [DRAFT] } })

    const heading = await screen.findByRole('heading', { name: 'Continue writing' })
    expect(heading.parentElement).toHaveTextContent('1 of 23')
  })

  it('tells a person with no workspaces whom to ask', async () => {
    home(me, NOTHING, {}, [])

    expect(await screen.findByText('No workspaces yet')).toBeInTheDocument()
    expect(screen.getByText(/Ask an administrator/)).toBeInTheDocument()
  })

  it('never shows the checklist or the settings to somebody who could not act on them', async () => {
    home(me, NOTHING, {}, [])

    await screen.findByText('No workspaces yet')
    expect(screen.queryByText('Set up your organisation')).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Organisation' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Organisation settings' })).not.toBeInTheDocument()
  })

  it('keeps the workspaces when only the summary fails, and offers to try again', async () => {
    let attempts = 0
    home(me, undefined, {
      'GET /api/home': () => {
        attempts += 1
        return attempts === 1
          ? errorResponse(500, 'internal', 'Boom')
          : jsonResponse(200, POPULATED)
      },
    })

    expect(await screen.findByText('Recent changes could not be loaded')).toBeInTheDocument()
    // The way in survives, without figures it was not told.
    expect(screen.getByRole('link', { name: /^Engineering/ })).not.toHaveTextContent('document')

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByRole('link', { name: /Release notes/ })).toBeInTheDocument()
  })
})

describe('an organisation with many workspaces', () => {
  const MANY = 40
  const manyWorkspaces = Array.from({ length: MANY }, (_, index) =>
    workspace(`ws-${index}`, `Workspace ${index}`, `unit-${index % 4}`, [
      'Acme',
      `Division ${index % 4}`,
    ]),
  )
  /** Higher numbers changed more recently, so the most active are the last ones. */
  const manyStats = manyWorkspaces.map((entry, index) =>
    stats(entry.id, 10 + index, 0, new Date(Date.UTC(2026, 2, 1, index)).toISOString()),
  )
  const summary = { ...POPULATED, stats: manyStats, drafts: { total: 0, items: [] } }

  it('starts with the most active few, and a way to see all of them', async () => {
    home(me, summary, {}, manyWorkspaces)

    const heading = await screen.findByRole('heading', { level: 2, name: 'Workspaces' })
    expect(heading.parentElement).toHaveTextContent(String(MANY))
    await screen.findByRole('link', { name: new RegExp(`^Workspace ${MANY - 1}`) })
    const section = screen.getByRole('region', { name: 'Workspaces' })
    expect(within(section).getAllByRole('link')).toHaveLength(PREVIEW_COUNT)
    expect(within(section).queryByRole('link', { name: /^Workspace 0/ })).not.toBeInTheDocument()
    expect(PREVIEW_COUNT).toBeLessThan(COLLAPSE_ABOVE)

    await userEvent.click(screen.getByRole('button', { name: `Show all ${MANY} workspaces` }))

    // Every one, grouped under the unit that holds it.
    expect(within(section).getAllByRole('link')).toHaveLength(MANY)
    expect(within(section).getAllByRole('heading', { level: 3 })).toHaveLength(4)
    expect(screen.getByRole('button', { name: 'Show fewer' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })

  it('puts the workspaces the person works in first, wherever they sit in the list', async () => {
    const engaged = manyStats.map((row, index) => ({
      ...row,
      engagement: index === 3 ? 50 : 0,
      // Everything else changed more recently than the one they work in.
      updatedAt: index === 3 ? '2026-01-01T00:00:00.000Z' : row.updatedAt,
    }))
    home(me, { ...summary, stats: engaged }, {}, manyWorkspaces)

    const section = await screen.findByRole('region', { name: 'Workspaces' })
    await waitFor(() => {
      expect(within(section).getAllByRole('link')[0]).toHaveTextContent('Workspace 3')
    })
  })

  it('finds any workspace by typing, wherever it ranks', async () => {
    home(me, summary, {}, manyWorkspaces)

    const filter = await screen.findByRole('searchbox', { name: 'Filter workspaces' })
    await userEvent.type(filter, 'workspace 7')

    const section = screen.getByRole('region', { name: 'Workspaces' })
    const links = within(section).getAllByRole('link')
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveTextContent('Workspace 7')

    await userEvent.clear(filter)
    await userEvent.type(filter, 'nothing like this')
    expect(await screen.findByRole('status')).toHaveTextContent(
      'No workspace matches “nothing like this”.',
    )
  })

  it('draws only the rows in view once the whole list is far longer than a screen', async () => {
    const thousands = Array.from({ length: 2000 }, (_, index) =>
      workspace(`big-${index}`, `Big workspace ${index}`, `unit-${index % 40}`, [
        'Acme',
        `Division ${index % 40}`,
      ]),
    )
    home(me, { ...summary, stats: [] }, {}, thousands)

    await userEvent.click(await screen.findByRole('button', { name: 'Show all 2000 workspaces' }))

    const list = await screen.findByRole('list', { name: 'Workspaces by unit' })
    const drawn = within(list).getAllByRole('listitem')
    expect(drawn.length).toBeLessThan(120)
    expect(drawn[0]).toHaveAttribute('aria-setsize', String(2000 + 40))
  })

  it('stays accessible', async () => {
    const { container } = home(me, summary, {}, manyWorkspaces)

    await screen.findByRole('searchbox', { name: 'Filter workspaces' })
    await expectNoAccessibilityViolations(container)
  })
})

describe('the administrator’s set-up checklist', () => {
  const FRESH: FakeRoutes = {
    'GET /api/units': () => jsonResponse(200, []),
    'GET /api/settings/organisation': () => jsonResponse(200, settings(BRAND.name)),
  }

  it('walks an administrator with nothing set up through the first unit, without saying it twice', async () => {
    const { container } = home(admin, NOTHING, FRESH, [])

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
    // The checklist is the one place that says there is nothing yet.
    expect(screen.queryByText('No workspaces yet')).not.toBeInTheDocument()
    await expectNoAccessibilityViolations(container)
  })

  it('points at the units and workspaces once the checklist is hidden', async () => {
    home(admin, NOTHING, FRESH, [])

    const checklist = await screen.findByRole('region', { name: 'Set up your organisation' })
    await userEvent.click(within(checklist).getByRole('button', { name: 'Hide' }))

    expect(
      within(await screen.findByRole('group', { name: /No workspaces yet/ })).getByRole('link', {
        name: 'Units and workspaces',
      }),
    ).toHaveAttribute('href', '/admin/organisation')
  })

  it('offers the next step, a workspace, once a unit exists', async () => {
    home(
      admin,
      NOTHING,
      {
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
      },
      [],
    )

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
      ['People and groups', '/admin/groups'],
    ])
  })

  it('can be hidden, and stays hidden', async () => {
    const first = home(admin, NOTHING, FRESH)

    const checklist = await screen.findByRole('region', { name: 'Set up your organisation' })
    await userEvent.click(within(checklist).getByRole('button', { name: 'Hide' }))
    expect(screen.queryByText('Set up your organisation')).not.toBeInTheDocument()

    first.unmount()
    home(admin, NOTHING, FRESH)
    await screen.findByRole('heading', { level: 2, name: 'Workspaces' })
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
