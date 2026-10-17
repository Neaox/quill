import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, onTestFinished, vi } from 'vitest'

import { packRanges } from '@quill/highlight'
import { toast } from '@quill/ui'
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
<div class="layout-wide"><div class="table-scroll" tabindex="0" role="group" aria-label="Table"><table><thead><tr><th scope="col">Region</th><th scope="col">Owner</th></tr></thead><tbody><tr><td>eu</td><td>Platform</td></tr></tbody></table></div></div>
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
      permissions: { view: true, comment: true, edit: true, publish: true, manage: false },
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

describe('the reading view records that it was opened', () => {
  it('tells the server once, for the person’s own history', async () => {
    const opened: string[] = []
    renderApp(
      READING_PATH,
      readingRoutes({
        'POST /api/documents/{id}/view': (_request, params) => {
          opened.push(String(params['id']))
          return new Response(undefined, { status: 204 })
        },
      }),
    )

    await screen.findByRole('article', { name: 'Regional failover' })

    await waitFor(() => {
      expect(opened).toHaveLength(1)
    })
  })

  it('reads fine when the record cannot be kept', async () => {
    renderApp(
      READING_PATH,
      readingRoutes({
        'POST /api/documents/{id}/view': () => errorResponse(500, 'internal', 'Boom'),
      }),
    )

    expect(await screen.findByRole('article', { name: 'Regional failover' })).toBeInTheDocument()
  })
})

const text = (value: string) => ({ type: 'text', value })
const draftOf =
  (...children: readonly object[]) =>
  () =>
    jsonResponse(200, {
      documentId: 'doc-1',
      draftVersion: 3,
      baseRevision: null,
      updatedAt: '2026-02-03T00:00:00.000Z',
      ast: { version: 1, frontMatter: {}, ast: { type: 'root', children } },
    })

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

  it('keeps the renderer’s labelled, keyboard-reachable scroll region round a table', async () => {
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
        .getAllByRole('link', { name: /^v\d/ })
        .map((link) => link.textContent),
    ).toEqual([expect.stringContaining('v2'), expect.stringContaining('v1')])
    expect(screen.getByText('Published')).toBeInTheDocument()
    // The person who published last is named as that. There is no "owner: —"
    // in the readout any more: an owner is ADR-029's `owners` front-matter
    // field, no M2 route carries it, and a fact nothing can answer is not
    // shown as a dash (`DocumentStatus` in `@quill/ui`).
    expect(await screen.findByText('Last published by Ada')).toBeInTheDocument()
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
          permissions: { view: true, comment: false, edit: false, publish: false, manage: false },
        }),
      }),
    )

    await screen.findByRole('article', { name: 'Regional failover' })
    expect(screen.queryByRole('link', { name: 'Edit' })).not.toBeInTheDocument()
  })

  it('tells an editor about changes that are saved and not published, and how to go on', async () => {
    renderApp(
      READING_PATH,
      readingRoutes({
        'GET /api/documents/{id}/envelope': envelope({
          draft: { savedAt: '2026-02-04T09:30:00.000Z' },
        }),
      }),
    )

    const notice = await screen.findByRole('group', { name: 'Note: You have unpublished changes' })

    expect(within(notice).getByText(/Readers still see the published page/u)).toBeInTheDocument()
    expect(within(notice).getByRole('link', { name: 'Resume editing' })).toHaveAttribute(
      'href',
      `${READING_PATH}/edit`,
    )
    const preview = within(notice).getByRole('link', {
      name: /^Preview\s+your unpublished changes/u,
    })
    expect(preview).toHaveAttribute('href', `/preview/d/regional-failover-${KEY}?draft`)
    expect(preview).toHaveAttribute('target', '_blank')
    // When it was saved, said as how long ago and in full on hover, by the platform.
    const saved = within(notice).getByRole('time')
    expect(saved).toHaveAttribute('datetime', '2026-02-04T09:30:00.000Z')
    expect(saved).toHaveAttribute('title')
  })

  it('has nothing to say when there are no unpublished changes', async () => {
    renderApp(READING_PATH, readingRoutes())

    await screen.findByRole('article', { name: 'Regional failover' })

    expect(screen.queryByText('You have unpublished changes')).not.toBeInTheDocument()
  })

  it('has nothing to say to somebody who may not edit, whatever the envelope holds', async () => {
    renderApp(
      READING_PATH,
      readingRoutes({
        'GET /api/documents/{id}/envelope': envelope({
          permissions: { view: true, comment: false, edit: false, publish: false, manage: false },
          draft: { savedAt: '2026-02-04T09:30:00.000Z' },
        }),
      }),
    )

    await screen.findByRole('article', { name: 'Regional failover' })

    expect(screen.queryByText('You have unpublished changes')).not.toBeInTheDocument()
  })

  it('is accessible with the notice showing', async () => {
    const { container } = renderApp(
      READING_PATH,
      readingRoutes({
        'GET /api/documents/{id}/envelope': envelope({
          draft: { savedAt: '2026-02-04T09:30:00.000Z' },
        }),
      }),
    )
    await screen.findByRole('group', { name: 'Note: You have unpublished changes' })

    await expectNoAccessibilityViolations(container)
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

  describe('a document that was never published', () => {
    const unpublished = (extra: FakeRoutes = {}) =>
      readingRoutes({
        'GET /api/documents/{id}/rendered': () =>
          errorResponse(404, 'not_found', 'This document has no published revision'),
        'GET /api/documents/{id}/history': () => jsonResponse(200, { revisions: [] }),
        ...extra,
      })

    it('says what is waiting to be published when there is a draft with writing in it, rather than that nothing is there', async () => {
      renderApp(
        READING_PATH,
        unpublished({
          'GET /api/documents/{id}/draft': draftOf(
            { type: 'heading', depth: 2, children: [text('Overview')] },
            {
              type: 'paragraph',
              children: [text('Three tiers and a cache in front of the slow one.')],
            },
            { type: 'heading', depth: 2, children: [text('Steps')] },
          ),
        }),
      )

      const note = await screen.findByRole('group', {
        name: 'Note: Written, but not published yet',
      })

      expect(note).toHaveTextContent('Your draft has 2 sections and about 11 words')
      expect(note).toHaveTextContent('Readers see nothing until you publish it')
      expect(within(note).getByRole('link', { name: 'Continue writing' })).toHaveAttribute(
        'href',
        `${READING_PATH}/edit`,
      )
    })

    it('offers a look at the draft as readers will see it, and does not claim readers still see a published page', async () => {
      renderApp(
        READING_PATH,
        unpublished({
          'GET /api/documents/{id}/envelope': envelope({
            lastPublished: null,
            draft: { savedAt: '2026-02-04T09:30:00.000Z' },
          }),
          'GET /api/documents/{id}/draft': draftOf({
            type: 'paragraph',
            children: [text('Three tiers and a cache in front of the slow one.')],
          }),
        }),
      )

      const note = await screen.findByRole('group', {
        name: 'Note: Written, but not published yet',
      })

      expect(
        within(note).getByRole('link', { name: /^Preview\s+your unpublished changes/u }),
      ).toHaveAttribute('href', `/preview/d/regional-failover-${KEY}?draft`)
      // There is no published page for readers to still be seeing.
      expect(
        screen.queryByRole('group', { name: 'Note: You have unpublished changes' }),
      ).not.toBeInTheDocument()
    })

    it('says so when the draft is only a template’s sections, with nothing written in them yet', async () => {
      renderApp(
        READING_PATH,
        unpublished({
          'GET /api/documents/{id}/draft': draftOf(
            { type: 'heading', depth: 2, children: [text('Context')] },
            {
              type: 'containerDirective',
              name: 'guidance',
              children: [
                { type: 'paragraph', children: [text('Say why in two or three sentences.')] },
              ],
            },
            { type: 'heading', depth: 2, children: [text('Decision')] },
          ),
        }),
      )

      const note = await screen.findByRole('group', { name: 'Note: Nothing written yet' })

      expect(note).toHaveTextContent('Your draft has 2 sections and no writing in them yet')
      expect(within(note).getByRole('link', { name: 'Start writing' })).toBeInTheDocument()
    })

    it('says only that it has not been published to somebody who cannot write it, and offers them nothing to do', async () => {
      renderApp(
        READING_PATH,
        unpublished({
          'GET /api/documents/{id}/envelope': envelope({
            permissions: { view: true, comment: false, edit: false, publish: false, manage: false },
          }),
        }),
      )

      const note = await screen.findByRole('group', { name: 'Note: Nothing published yet' })

      expect(note).toHaveTextContent('has not been published yet')
      expect(note).not.toHaveTextContent('write something')
      expect(within(note).queryByRole('link')).toBeNull()
    })
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
    // The sidebar's tree is its own request now, opened down to the document
    // (`useNavigationTree`), so it may land a moment after the notice.
    expect(await screen.findByRole('navigation', { name: 'Documents' })).toBeInTheDocument()
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

  it('does not offer to restore a revision to somebody who cannot publish', async () => {
    renderApp(`${READING_PATH}?rev=${'a'.repeat(40)}`, {
      ...readingRoutes(),
      'GET /api/documents/{id}/envelope': envelope({
        permissions: { view: true, comment: true, edit: true, publish: false, manage: false },
      }),
    })

    await screen.findByRole('article', { name: 'Regional failover' })
    expect(screen.queryByRole('button', { name: 'Restore this revision' })).not.toBeInTheDocument()
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

const A = 'a'.repeat(40)
const B = 'b'.repeat(40)

/** A comparison in exactly the shape `renderComparison` emits. */
const COMPARISON_HTML = `<article>
<h1 id="regional-failover">Regional failover<a class="heading-anchor" href="#regional-failover" aria-label="Permalink: Regional failover">#</a></h1>
<p data-change="changed" data-change-id="c1">Move traffic <del data-diff="removed"><span data-diff-label="">Removed: </span>east</del><ins data-diff="added"><span data-diff-label="">Added: </span>west</ins>.</p>
<p>Unchanged one.</p>
<p>Unchanged two.</p>
<p>Unchanged three.</p>
<p>Unchanged four.</p>
<p>Unchanged five.</p>
<p>Unchanged six.</p>
<h2 id="afterwards">Afterwards<a class="heading-anchor" href="#afterwards" aria-label="Permalink: Afterwards">#</a></h2>
<p data-change="added" data-change-id="c2"><ins data-diff="added"><span data-diff-label="">Added: </span>Tell the on-call engineer.</ins></p>
</article>`

const comparison = () =>
  jsonResponse(200, {
    html: COMPARISON_HTML,
    summary: {
      sections: 2,
      added: 1,
      removed: 0,
      changed: 1,
      moved: 0,
      wordsAdded: 6,
      wordsRemoved: 1,
    },
    changes: [
      {
        id: 'c1',
        change: 'changed',
        block: 'paragraph',
        excerpt: 'Move traffic west.',
        wordsAdded: 1,
        wordsRemoved: 1,
        section: { id: 'regional-failover', title: 'Regional failover' },
      },
      {
        id: 'c2',
        change: 'added',
        block: 'paragraph',
        excerpt: 'Tell the on-call engineer.',
        wordsAdded: 5,
        wordsRemoved: 0,
        section: { id: 'afterwards', title: 'Afterwards' },
      },
    ],
    sections: [
      { id: 'regional-failover', depth: 1, title: 'Regional failover', changes: 1 },
      { id: 'afterwards', depth: 2, title: 'Afterwards', changes: 1 },
    ],
    properties: [{ name: 'status', before: 'draft', after: 'published' }],
  })

const sourceComparison = () =>
  jsonResponse(200, {
    lines: [
      {
        change: 'equal',
        before: 1,
        after: 1,
        segments: [{ change: 'equal', text: '# Regional failover' }],
      },
      {
        change: 'removed',
        before: 2,
        segments: [
          { change: 'equal', text: 'Move traffic ' },
          { change: 'removed', text: 'east' },
          { change: 'equal', text: '.' },
        ],
      },
      {
        change: 'added',
        after: 2,
        segments: [
          { change: 'equal', text: 'Move traffic ' },
          { change: 'added', text: 'west' },
          { change: 'equal', text: '.' },
        ],
      },
    ],
    wordsAdded: 1,
    wordsRemoved: 1,
  })

const COMPARING = `${READING_PATH}?from=${A}&to=${B}`

describe('comparing two revisions', () => {
  it('draws the document with its changes marked, folds what did not change, and starts at the summary', async () => {
    const { container } = renderApp(COMPARING, {
      ...readingRoutes(),
      'GET /api/documents/{id}/compare': comparison,
    })

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Changes between v1 and v2' }),
    ).toBeInTheDocument()
    const summary = await screen.findByRole('region', {
      name: 'Summary of Changes between v1 and v2',
    })
    expect(summary).toHaveTextContent(
      '2 sections changed · 1 added · 1 edited · 6 words added · 1 word removed',
    )
    expect(summary).toHaveFocus()
    // Focus put there for a screen reader, which no key reaches, paints no ring.
    expect(summary).toHaveAttribute('tabindex', '-1')
    expect(summary).toHaveClass('focus:outline-hidden')
    expect(within(summary).getByText('draft')).toBeInTheDocument()

    const article = await screen.findByRole('article', { name: 'Changes between v1 and v2' })
    expect(within(article).getAllByText(/Removed:/)).toHaveLength(1)
    expect(
      await within(article).findByRole('button', { name: 'Show 5 unchanged paragraphs' }),
    ).toBeInTheDocument()
    // No Git: nothing on the page names a hunk, a path or a hash.
    expect(container.textContent).not.toMatch(/@@|runbooks\/failover\.md|[0-9a-f]{40}/)
    await expectNoAccessibilityViolations(container)
  })

  it('steps through the changes with the buttons and with n and p', async () => {
    renderApp(COMPARING, { ...readingRoutes(), 'GET /api/documents/{id}/compare': comparison })
    const summary = await screen.findByRole('region', { name: /^Summary/ })
    await screen.findByRole('button', { name: /unchanged paragraphs/ })

    await userEvent.click(within(summary).getByRole('button', { name: 'Next' }))
    expect(within(summary).getByText('Change 1 of 2')).toBeInTheDocument()
    expect(window.document.querySelector('[data-change-id="c1"]')).toHaveAttribute(
      'data-change-current',
    )

    await userEvent.keyboard('n')
    expect(within(summary).getByText('Change 2 of 2')).toBeInTheDocument()
    expect(window.document.querySelector('[data-change-id="c2"]')).toHaveFocus()

    await userEvent.keyboard('k')
    expect(within(summary).getByText('Change 1 of 2')).toBeInTheDocument()
  })

  it('lists the changes beside the page, and marks the sections that have them', async () => {
    renderApp(COMPARING, { ...readingRoutes(), 'GET /api/documents/{id}/compare': comparison })

    const list = await screen.findByRole('navigation', { name: 'Changes (2)' })
    const added = within(list).getByRole('button', { name: /Added Paragraph/ })
    // The section is said in full, never cut short, and read as where the change is.
    expect(added).toHaveAccessibleName(/^Added Paragraph\s+in\s?Afterwards\s+Tell the on-call/)
    await userEvent.click(added)
    expect(added).toHaveAttribute('aria-current', 'true')

    const sections = screen.getByRole('navigation', { name: 'Sections' })
    expect(within(sections).getByRole('link', { name: /Afterwards/ })).toHaveTextContent('1 change')
  })

  it('chooses the versions from the pickers, and swaps them', async () => {
    renderApp(COMPARING, { ...readingRoutes(), 'GET /api/documents/{id}/compare': comparison })

    await userEvent.click(await screen.findByRole('button', { name: 'Swap the two versions' }))
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Changes between v2 and v1' }),
    ).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /^To: v1/ }))
    const menu = await screen.findByRole('menu', { name: 'To' })
    expect(within(menu).getByRole('menuitemradio', { name: /^v2/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    await userEvent.click(within(menu).getByRole('menuitemradio', { name: /^Your draft/ }))
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Changes between v2 and your draft' }),
    ).toBeInTheDocument()
  })

  it('shows the Markdown line by line, with no Git headers', async () => {
    renderApp(`${COMPARING}&view=source&layout=unified`, {
      ...readingRoutes(),
      'GET /api/documents/{id}/compare': comparison,
      'GET /api/documents/{id}/compare/source': sourceComparison,
    })

    const table = await screen.findByRole('table', {
      name: 'Changes between v1 and v2, as Markdown',
    })
    expect(within(table).getByText('Removed line')).toBeInTheDocument()
    expect(within(table).getByText('west').tagName).toBe('INS')
    expect(table.textContent).not.toMatch(/@@|^---|^\+\+\+/m)
    await expectNoAccessibilityViolations(table)
  })

  it('opens from the revisions beside a document, and offers each row its comparison', async () => {
    renderApp(READING_PATH, {
      ...readingRoutes(),
      'GET /api/documents/{id}/compare': comparison,
    })

    expect(
      await screen.findByRole('link', { name: 'Compare v2 with the previous version' }),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('link', { name: 'Compare versions' }))
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Changes between v1 and v2' }),
    ).toBeInTheDocument()
  })
})

describe('comparing the published page with the draft', () => {
  const COMPARING_DRAFT = `${READING_PATH}?from=${B}&to=draft`
  const withDraftChanges = () =>
    jsonResponse(200, {
      html: COMPARISON_HTML,
      summary: {
        sections: 2,
        added: 1,
        removed: 0,
        changed: 1,
        moved: 1,
        wordsAdded: 6,
        wordsRemoved: 1,
      },
      changes: [
        {
          id: 'c1',
          change: 'changed',
          block: 'paragraph',
          excerpt: 'Move traffic west.',
          wordsAdded: 1,
          wordsRemoved: 1,
          section: { id: 'regional-failover', title: 'Regional failover' },
          revertible: true,
          author: { id: 'user-2', name: 'Ada', at: '2026-02-04T09:30:00.000Z' },
        },
        {
          id: 'c2',
          change: 'added',
          block: 'paragraph',
          excerpt: 'Tell the on-call engineer.',
          wordsAdded: 5,
          wordsRemoved: 0,
          section: { id: 'afterwards', title: 'Afterwards' },
          revertible: true,
        },
        {
          id: 'c3',
          change: 'moved',
          block: 'paragraph',
          excerpt: 'Check the dashboard.',
          wordsAdded: 0,
          wordsRemoved: 0,
          section: { id: 'afterwards', title: 'Afterwards' },
          revertible: false,
        },
      ],
      sections: [
        { id: 'regional-failover', depth: 1, title: 'Regional failover', changes: 1 },
        { id: 'afterwards', depth: 2, title: 'Afterwards', changes: 2 },
      ],
      properties: [],
    })

  function draftRoutes(extra: FakeRoutes = {}): FakeRoutes {
    return readingRoutes({
      'GET /api/documents/{id}/compare': withDraftChanges,
      'GET /api/documents/{id}/draft': draftOf({ type: 'paragraph', children: [text('Draft.')] }),
      ...extra,
    })
  }

  /** The list of changes, once the draft it reverts into has been read. */
  async function changeList() {
    const list = await screen.findByRole('navigation', { name: 'Changes (3)' })
    await waitFor(() => {
      expect(
        within(list).getByRole('button', { name: /^Revert: Edited Paragraph/u }),
      ).not.toHaveAttribute('aria-disabled')
    })
    return list
  }

  it('says who made each change and when, from the draft’s record', async () => {
    renderApp(COMPARING_DRAFT, draftRoutes())

    const list = await screen.findByRole('navigation', { name: 'Changes (3)' })
    const changed = within(list).getByRole('button', { name: /^Edited Paragraph/u })
    expect(changed).toHaveTextContent('Ada ·')
    expect(within(changed).getByRole('time')).toHaveAttribute(
      'datetime',
      '2026-02-04T09:30:00.000Z',
    )
  })

  it('keeps Revert on a change that cannot be reverted, disabled, and says why', async () => {
    renderApp(COMPARING_DRAFT, draftRoutes())

    const list = await changeList()
    const moved = within(list).getByRole('button', { name: /^Revert: Moved Paragraph/u })
    expect(moved).toHaveAttribute('aria-disabled', 'true')
    expect(moved).toHaveAccessibleDescription(/A move can’t be reverted/u)
    expect(moved).toHaveAttribute('title', expect.stringMatching(/only its place differs/u))
    expect(within(list).getByText('A move can’t be reverted')).toBeVisible()
    expect(within(list).getByRole('checkbox', { name: /^Select: Moved Paragraph/u })).toBeDisabled()
  })

  it('reverts one change in the draft, as one save, and offers to undo it', async () => {
    const success = vi.spyOn(toast, 'success')
    onTestFinished(() => {
      success.mockRestore()
    })
    const bodies: unknown[] = []
    const undone: unknown[] = []
    renderApp(
      COMPARING_DRAFT,
      draftRoutes({
        'POST /api/documents/{id}/draft/revert': async (request) => {
          bodies.push(await request.json())
          return jsonResponse(200, { draftVersion: 4, previous: { version: 1, kept: true } })
        },
        'POST /api/documents/{id}/draft/revert/undo': async (request) => {
          undone.push(await request.json())
          return jsonResponse(200, { draftVersion: 5 })
        },
      }),
    )

    const list = await changeList()
    await userEvent.click(within(list).getByRole('button', { name: /^Revert: Edited Paragraph/u }))

    await waitFor(() => {
      expect(bodies).toEqual([{ from: B, draftVersion: 3, changes: ['c1'] }])
    })
    // The toast host is the shell's; what the toast offers is what is checked here.
    await waitFor(() => {
      expect(success).toHaveBeenCalledWith('Change reverted in your draft', expect.anything())
    })
    const offered = success.mock.calls[0]?.[1]
    act(() => {
      offered?.action?.onClick()
    })
    await waitFor(() => {
      expect(undone).toEqual([{ draftVersion: 4, ast: { version: 1, kept: true } }])
    })
  })

  it('reverts the changes picked, all in one save, and every revertible one at once', async () => {
    const bodies: unknown[] = []
    renderApp(
      COMPARING_DRAFT,
      draftRoutes({
        'POST /api/documents/{id}/draft/revert': async (request) => {
          bodies.push(await request.json())
          return jsonResponse(200, { draftVersion: 4, previous: { version: 1 } })
        },
      }),
    )

    const list = await changeList()
    const selected = within(list).getByRole('button', { name: /^Revert selected/u })
    expect(selected).toHaveAttribute('aria-disabled', 'true')
    expect(selected).toHaveAccessibleDescription('Select the changes to revert')

    await userEvent.click(within(list).getByRole('checkbox', { name: 'Select all revertible' }))
    await userEvent.click(within(list).getByRole('button', { name: 'Revert 2 selected' }))

    await waitFor(() => {
      expect(bodies).toEqual([{ from: B, draftVersion: 3, changes: ['c1', 'c2'] }])
    })
  })

  it('says why, when somebody else is editing the document', async () => {
    const danger = vi.spyOn(toast, 'danger')
    onTestFinished(() => {
      danger.mockRestore()
    })
    renderApp(
      COMPARING_DRAFT,
      draftRoutes({
        'POST /api/documents/{id}/draft/revert': () =>
          errorResponse(423, 'lock_lost', 'You do not hold a valid lock on this document'),
      }),
    )

    const list = await changeList()
    await userEvent.click(within(list).getByRole('button', { name: /^Revert: Edited Paragraph/u }))

    await waitFor(() => {
      expect(danger).toHaveBeenCalledWith(expect.stringMatching(/edited in another session/u))
    })
  })

  it('offers nothing to revert to somebody who may not edit', async () => {
    renderApp(
      COMPARING_DRAFT,
      draftRoutes({
        'GET /api/documents/{id}/envelope': envelope({
          permissions: { view: true, comment: true, edit: false, publish: false, manage: false },
        }),
      }),
    )

    const list = await screen.findByRole('navigation', { name: 'Changes (3)' })
    expect(within(list).queryByRole('button', { name: /^Revert/u })).not.toBeInTheDocument()
  })

  it('offers nothing to revert between two published revisions', async () => {
    renderApp(COMPARING, draftRoutes())

    const list = await screen.findByRole('navigation', { name: 'Changes (3)' })
    expect(within(list).queryByRole('button', { name: /^Revert/u })).not.toBeInTheDocument()
  })

  it('has no axe violations with the authors and the revert controls showing', async () => {
    const { container } = renderApp(COMPARING_DRAFT, draftRoutes())
    await changeList()

    await expectNoAccessibilityViolations(container)
  })
})

/*
 * On a phone the bar keeps the tree's button, Edit and the person menu, and
 * folds the rest into the document's "…" menu (2026-10-17): at 320 pixels the
 * compare page's bar ran 52 pixels off the screen. Folded, every control is
 * still reachable, under the same conditions it is offered in the bar.
 */
/** Answers the medium-breakpoint query as a phone would; returns the undo. */
function onAPhone(): () => void {
  Object.defineProperty(globalThis, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: query.includes('48rem'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  })
  return () => {
    Reflect.deleteProperty(globalThis, 'matchMedia')
  }
}

describe('the document bar on a phone', () => {
  it('folds rename, present, preview and share into the menu, and keeps Edit', async () => {
    const restore = onAPhone()
    try {
      renderApp(
        READING_PATH,
        readingRoutes({
          'GET /api/documents/{id}/envelope': envelope({
            permissions: { view: true, comment: true, edit: true, manage: true },
          }),
        }),
      )

      expect(await screen.findByRole('link', { name: 'Edit' })).toBeInTheDocument()
      const bar = screen.getByRole('banner')
      expect(within(bar).queryByRole('button', { name: 'Share' })).not.toBeInTheDocument()
      expect(within(bar).queryByRole('link', { name: 'Present' })).not.toBeInTheDocument()
      expect(within(bar).queryByRole('button', { name: /^Rename/ })).not.toBeInTheDocument()

      await userEvent.click(
        within(bar).getByRole('button', { name: 'More actions for Regional failover' }),
      )
      const menu = await screen.findByRole('menu')
      const items = within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent)
      expect(items).toEqual(
        expect.arrayContaining(['Rename…', 'Present', 'Preview as a reader', 'Share…']),
      )
    } finally {
      restore()
    }
  })

  it('offers a request for review in the menu, which the bar has no room for', async () => {
    const restore = onAPhone()
    try {
      renderApp(
        READING_PATH,
        readingRoutes({
          'GET /api/documents/{id}/envelope': envelope({
            draft: { savedAt: '2026-02-04T09:30:00.000Z' },
          }),
        }),
      )

      expect(await screen.findByRole('link', { name: 'Edit' })).toBeInTheDocument()
      const bar = within(screen.getByRole('banner'))
      await userEvent.click(bar.getByRole('button', { name: 'More actions for Regional failover' }))
      await userEvent.click(await screen.findByRole('menuitem', { name: 'Request review…' }))

      expect(await screen.findByRole('dialog', { name: 'Request a review' })).toBeInTheDocument()
    } finally {
      restore()
    }
  })

  it('does not offer a review when the draft holds nothing new', async () => {
    const restore = onAPhone()
    try {
      renderApp(READING_PATH, readingRoutes())

      expect(await screen.findByRole('link', { name: 'Edit' })).toBeInTheDocument()
      const bar = within(screen.getByRole('banner'))
      await userEvent.click(bar.getByRole('button', { name: 'More actions for Regional failover' }))
      await screen.findByRole('menu')
      expect(screen.queryByRole('menuitem', { name: 'Request review…' })).not.toBeInTheDocument()
    } finally {
      restore()
    }
  })
})
