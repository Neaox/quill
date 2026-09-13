import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { packRanges } from '@quill/highlight'
import { expectNoAccessibilityViolations } from '@quill/ui/testing/axe'

import { intersectionObservers } from '../../../testing/browser-shims.ts'
import { renderApp } from '../../lib/api/render-app.tsx'
import { errorResponse, jsonResponse, type FakeRoutes } from '../../lib/api/testing.ts'

// Factories, not constants: a `Response` body can only be read once, and this
// page mounts several observers of the same query.
const me = () =>
  jsonResponse(200, {
    id: 'user-1',
    email: 'reader@example.com',
    displayName: 'Reader',
    emailVerified: true,
    isInstanceAdmin: false,
  })

const workspace = () =>
  jsonResponse(200, {
    id: 'acme',
    unitId: 'unit-1',
    name: 'Engineering',
    slug: 'engineering',
    createdAt: '2026-01-01T00:00:00.000Z',
  })

/** The document's public handle, and the canonical address it makes (ADR-035). */
const KEY = 'k7m3q9v2rt'
const READING_PATH = `/w/acme/d/regional-failover-${KEY}`

const document = () =>
  jsonResponse(200, {
    id: 'doc-1',
    shortId: KEY,
    workspaceId: 'acme',
    collectionId: 'col-1',
    parentId: null,
    slug: 'failover',
    path: 'runbooks/failover.md',
    title: 'Regional failover',
    status: 'published',
    templateId: null,
    templateVersion: null,
    headRevision: 'b'.repeat(40),
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-02-03T00:00:00.000Z',
  })

const CODE = 'export const region = "eu"'
const TOKENS = packRanges([
  { start: 0, end: 6, type: 'keyword' },
  { start: 7, end: 12, type: 'keyword' },
])

/**
 * A body in exactly the shape the Markdown renderer emits: one `article`
 * wrapper, headings with permalink anchors, a `:::wide` block as a
 * `div.layout-wide`, a bare table, and a code block carrying packed ranges.
 */
const BODY_HTML = `<article>
<h1 id="regional-failover">Regional failover<a class="heading-anchor" href="#regional-failover" aria-label="Permalink: Regional failover">#</a></h1>
<p>How to move traffic between regions.</p>
<h2 id="steps">Steps<a class="heading-anchor" href="#steps" aria-label="Permalink: Steps">#</a></h2>
<pre><code data-lang="ts" data-tokens="${TOKENS}">${CODE}</code></pre>
<div class="layout-wide"><table><thead><tr><th scope="col">Region</th><th scope="col">Owner</th></tr></thead><tbody><tr><td>eu</td><td>Platform</td></tr></tbody></table></div>
<h2 id="afterwards">Afterwards<a class="heading-anchor" href="#afterwards" aria-label="Permalink: Afterwards">#</a></h2>
<p>Tell the on-call engineer.</p>
</article>`

/** Answers with the revision that was asked for, as the real route does. */
const renderedAt = (request: Request) =>
  jsonResponse(200, {
    revision: new URL(request.url).searchParams.get('revision') ?? 'b'.repeat(40),
    html: BODY_HTML,
    outline: [
      {
        id: 'regional-failover',
        depth: 1,
        text: 'Regional failover',
        children: [
          { id: 'steps', depth: 2, text: 'Steps', children: [] },
          { id: 'afterwards', depth: 2, text: 'Afterwards', children: [] },
        ],
      },
    ],
    slots: [],
  })

function envelope(overrides: Record<string, unknown> = {}) {
  return () =>
    jsonResponse(200, {
      permissions: { view: true, comment: true, edit: true, manage: false },
      lock: null,
      lastPublished: { revision: 'b'.repeat(40), author: 'Ada', at: '2026-02-03T00:00:00.000Z' },
      review: null,
      health: [],
      ...overrides,
    })
}

const history = () =>
  jsonResponse(200, {
    revisions: [
      {
        revision: 'b'.repeat(40),
        author: { name: 'Ada', email: 'ada@example.com' },
        timestamp: '2026-02-03T00:00:00.000Z',
        summary: 'Regional failover',
      },
      {
        revision: 'a'.repeat(40),
        author: { name: 'Ada', email: 'ada@example.com' },
        timestamp: '2026-01-02T00:00:00.000Z',
        summary: 'First draft',
      },
    ],
  })

function readingRoutes(overrides: FakeRoutes = {}): FakeRoutes {
  return {
    'GET /api/me': me,
    'GET /api/workspaces/{id}': workspace,
    'GET /api/documents/{id}': document,
    'GET /api/workspaces/{workspaceId}/documents': () => jsonResponse(200, []),
    'GET /api/documents/{id}/rendered': renderedAt,
    'GET /api/documents/{id}/envelope': envelope(),
    'GET /api/documents/{id}/history': history,
    ...overrides,
  }
}

describe('the reading view', () => {
  it('renders the published body on the reading grid, with breakout widths intact', async () => {
    renderApp(READING_PATH, readingRoutes())

    const article = await screen.findByRole('article', { name: 'Regional failover' })
    // The renderer's own `article` wrapper is dropped: the blocks are direct
    // children of the reading grid, which is what ADR-027's named lines need.
    expect(article.querySelector(':scope > article')).toBeNull()
    expect(article.querySelector(':scope > .layout-wide')).not.toBeNull()
    expect(
      await screen.findByRole('heading', { level: 1, name: /Regional failover/ }),
    ).toBeInTheDocument()
  })

  it('highlights code blocks from the ranges the server packed (ADR-030)', async () => {
    renderApp(READING_PATH, readingRoutes())

    const article = await screen.findByRole('article', { name: 'Regional failover' })
    const code = article.querySelector('code')

    // jsdom has no `CSS.highlights`, so the client takes the ADR's markup
    // fallback — the same ranges, painted as spans.
    expect(code?.querySelectorAll('.tok-keyword')).toHaveLength(2)
    expect(code?.textContent).toBe(CODE)
  })

  it('puts a rendered table in a labelled, keyboard-reachable scroll region', async () => {
    renderApp(READING_PATH, readingRoutes())

    const article = await screen.findByRole('article', { name: 'Regional failover' })
    const region = article.querySelector('.table-scroll')

    expect(region).toHaveAttribute('role', 'group')
    expect(region).toHaveAttribute('tabindex', '0')
    expect(region?.querySelector('table')).not.toBeNull()
  })

  it('lists the document’s own sections, without repeating its title', async () => {
    renderApp(READING_PATH, readingRoutes())

    const contents = await screen.findByRole('navigation', { name: 'On this page' })
    const links = within(contents).getAllByRole('link')

    expect(links.map((link) => link.textContent)).toEqual(['Steps', 'Afterwards'])
  })

  it('follows the reader down the page', async () => {
    renderApp(READING_PATH, readingRoutes())
    const contents = await screen.findByRole('navigation', { name: 'On this page' })

    act(() => {
      for (const observer of intersectionObservers) {
        observer.intersect({ steps: false, afterwards: true })
      }
    })

    expect(within(contents).getByRole('link', { name: 'Afterwards' })).toHaveAttribute(
      'aria-current',
      'true',
    )
    expect(within(contents).getByRole('link', { name: 'Steps' })).not.toHaveAttribute(
      'aria-current',
    )
  })

  it('shows the revision list, the state, and the last publish in the readout', async () => {
    renderApp(READING_PATH, readingRoutes())

    const revisions = await screen.findByRole('region', { name: 'Revisions' })
    expect(
      within(revisions)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual([expect.stringContaining('v2'), expect.stringContaining('v1')])
    expect(screen.getByText('published')).toBeInTheDocument()
    // The person who published last is named as that. There is no "owner: —"
    // in the readout any more: an owner is ADR-029's `owners` front-matter
    // field, no M2 route carries it, and a fact nothing can answer is not
    // shown as a dash (`DocumentStatus` in `@quill/ui`).
    expect(await screen.findByText('last published by Ada')).toBeInTheDocument()
    expect(screen.queryByText(/^owner:/)).not.toBeInTheDocument()
  })

  it('offers Edit to someone who may edit', async () => {
    renderApp(READING_PATH, readingRoutes())

    expect(await screen.findByRole('link', { name: 'Edit' })).toHaveAttribute(
      'href',
      `${READING_PATH}/edit`,
    )
  })

  it('withholds Edit from a reader whose envelope does not permit it', async () => {
    renderApp(
      READING_PATH,
      readingRoutes({
        'GET /api/documents/{id}/envelope': envelope({
          permissions: { view: true, comment: false, edit: false, manage: false },
        }),
      }),
    )

    await screen.findByRole('article', { name: 'Regional failover' })
    expect(screen.queryByRole('link', { name: 'Edit' })).not.toBeInTheDocument()
  })

  it('says who is editing, when someone is', async () => {
    renderApp(
      READING_PATH,
      readingRoutes({
        'GET /api/documents/{id}/envelope': envelope({
          lock: {
            holderUserId: 'user-2',
            holderName: 'Grace',
            expiresAt: '2026-02-03T00:01:00.000Z',
          },
        }),
      }),
    )

    expect(await screen.findByText('Grace is editing')).toBeInTheDocument()
  })

  it('shows health signals quietly, in words', async () => {
    renderApp(
      READING_PATH,
      readingRoutes({
        'GET /api/documents/{id}/envelope': envelope({
          health: [{ kind: 'no-owner' }, { kind: 'required-section-empty', detail: 'Decision' }],
        }),
      }),
    )

    const signals = await screen.findByRole('region', { name: 'Signals' })
    expect(within(signals).getByText('no owner')).toBeInTheDocument()
    expect(within(signals).getByText(/Decision/)).toBeInTheDocument()
  })

  it('treats a document that was never published as an empty state, not a failure', async () => {
    renderApp(
      READING_PATH,
      readingRoutes({
        'GET /api/documents/{id}/rendered': () =>
          errorResponse(404, 'not_found', 'This document has no published revision'),
        'GET /api/documents/{id}/history': () => jsonResponse(200, { revisions: [] }),
      }),
    )

    expect(
      await screen.findByRole('group', { name: 'Note: Nothing published yet' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Start writing' })).toHaveAttribute(
      'href',
      `${READING_PATH}/edit`,
    )
    // The title still has to come from somewhere when the body cannot.
    expect(screen.getByRole('heading', { level: 1, name: 'Regional failover' })).toBeInTheDocument()
  })

  it('reports a real failure as one, with a way to try again', async () => {
    renderApp(
      READING_PATH,
      readingRoutes({
        'GET /api/documents/{id}/rendered': () =>
          errorResponse(500, 'internal_error', 'Internal Server Error'),
      }),
    )

    expect(
      await screen.findByRole('group', { name: "Danger: Couldn't load this document" }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('answers a document that does not exist with a not-found inside the shell', async () => {
    renderApp('/w/acme/d/missing', {
      'GET /api/me': me,
      'GET /api/workspaces/{id}': workspace,
      'GET /api/workspaces/{id}/tree': () => jsonResponse(200, { collections: [] }),
      'GET /api/documents/{id}': () => errorResponse(404, 'not_found', 'Document not found'),
    })

    expect(await screen.findByText("We couldn't find that document")).toBeInTheDocument()
    // The shell is still around it: the sidebar is how you get somewhere else.
    expect(screen.getByRole('navigation', { name: 'Documents' })).toBeInTheDocument()
  })

  it('has no axe violations', async () => {
    const { container } = renderApp(READING_PATH, readingRoutes())
    await screen.findByRole('article', { name: 'Regional failover' })

    await expectNoAccessibilityViolations(container)
  })
})

describe('reading an older revision', () => {
  it('says which revision is on screen and offers the way back', async () => {
    renderApp(`${READING_PATH}?rev=${'a'.repeat(40)}`, readingRoutes())

    expect(await screen.findByText(/reading v1/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to the current revision' })).toHaveAttribute(
      'href',
      READING_PATH,
    )
  })

  it('restores it, which publishes a new revision and returns to the current one', async () => {
    const restored: Array<{ revision: string }> = []
    renderApp(`${READING_PATH}?rev=${'a'.repeat(40)}`, {
      ...readingRoutes(),
      'POST /api/documents/{id}/restore': async (request) => {
        restored.push((await request.json()) as { revision: string })
        return jsonResponse(200, {
          kind: 'published',
          revision: 'c'.repeat(40),
          warnings: [],
          frontMatterIssues: [],
          incompleteRequiredSections: [],
        })
      },
    })

    await userEvent.click(await screen.findByRole('button', { name: 'Restore this revision' }))
    const dialog = await screen.findByRole('dialog', { name: 'Restore v1' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Restore' }))

    expect(restored).toEqual([{ revision: 'a'.repeat(40), changeNote: 'Restored v1' }])
    expect(await screen.findByRole('article', { name: 'Regional failover' })).toBeInTheDocument()
  })
})

describe('comparing two revisions', () => {
  it('loads the diff view on demand and renders added and removed lines', async () => {
    renderApp(`${READING_PATH}?from=${'a'.repeat(40)}&to=${'b'.repeat(40)}`, {
      ...readingRoutes(),
      'GET /api/documents/{id}/diff': () =>
        jsonResponse(200, {
          from: 'a'.repeat(40),
          to: 'b'.repeat(40),
          unified: '--- a\n+++ b\n@@ -1 +1 @@\n-old line\n+new line',
          added: 1,
          removed: 1,
        }),
    })

    expect(await screen.findByRole('heading', { name: 'Comparing v1 with v2' })).toBeInTheDocument()
    const diff = await screen.findByRole('group', { name: 'Unified diff' })
    const added = within(diff).getByText('+new line').closest('span')
    const removed = within(diff).getByText('-old line').closest('span')
    // The change is an attribute on the line, so it is what the styling and
    // the screen reader both read (docs/architecture/styling.md).
    expect(added).toHaveAttribute('data-change', 'added')
    expect(removed).toHaveAttribute('data-change', 'removed')
    expect(within(diff).getByText('added:')).toBeInTheDocument()
  })

  it('compares the two revisions a reader picks', async () => {
    renderApp(READING_PATH, {
      ...readingRoutes(),
      'GET /api/documents/{id}/diff': () =>
        jsonResponse(200, { from: null, to: 'b', unified: '', added: 0, removed: 0 }),
    })

    await userEvent.click(await screen.findByText('Compare', { selector: 'summary' }))
    await userEvent.selectOptions(screen.getByLabelText('From'), 'a'.repeat(40))
    await userEvent.selectOptions(screen.getByLabelText('To'), 'b'.repeat(40))
    await userEvent.click(screen.getByRole('button', { name: 'Compare' }))

    expect(await screen.findByRole('heading', { name: 'Comparing v1 with v2' })).toBeInTheDocument()
  })
})
