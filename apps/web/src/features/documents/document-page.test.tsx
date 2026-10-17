import { act, screen, waitFor, within } from '@testing-library/react'
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
    // The highlighting is an enhancement that loads after the words are on screen.
    await waitFor(() => {
      expect(code?.querySelectorAll('.tok-keyword')).toHaveLength(2)
    })
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

  it('starts with no section marked, because nothing has been read yet', async () => {
    renderApp(READING_PATH, readingRoutes())
    const contents = await screen.findByRole('navigation', { name: 'On this page' })

    act(() => {
      for (const observer of intersectionObservers) {
        observer.intersect({ steps: false, afterwards: false })
      }
    })

    expect(within(contents).queryAllByRole('link', { current: true })).toEqual([])
  })

  it('marks the section being read when none of its headings is in view, from where the reader scrolled past', async () => {
    renderApp(READING_PATH, readingRoutes())
    const contents = await screen.findByRole('navigation', { name: 'On this page' })

    act(() => {
      for (const observer of intersectionObservers) {
        observer.intersect({ steps: 'above', afterwards: 'below' })
      }
    })

    expect(within(contents).getByRole('link', { name: 'Steps' })).toHaveAttribute(
      'aria-current',
      'true',
    )
  })

  it('goes back up the contents as the reader scrolls back up the page', async () => {
    renderApp(READING_PATH, readingRoutes())
    const contents = await screen.findByRole('navigation', { name: 'On this page' })

    act(() => {
      for (const observer of intersectionObservers) {
        observer.intersect({ steps: 'above', afterwards: true })
      }
    })
    expect(within(contents).getByRole('link', { name: 'Afterwards' })).toHaveAttribute(
      'aria-current',
      'true',
    )

    // Back up: "Afterwards" slides out of the bottom of the band, and the one
    // before it, which is above, is where the reader is.
    act(() => {
      for (const observer of intersectionObservers) {
        observer.intersect({ afterwards: 'below' })
      }
    })
    expect(within(contents).getByRole('link', { name: 'Steps' })).toHaveAttribute(
      'aria-current',
      'true',
    )
    expect(within(contents).getByRole('link', { name: 'Afterwards' })).not.toHaveAttribute(
      'aria-current',
    )
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
          permissions: { view: true, comment: false, edit: false, manage: false },
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
          permissions: { view: true, comment: false, edit: false, manage: false },
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
            permissions: { view: true, comment: false, edit: false, manage: false },
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

/** What `GET /documents/:id/compare` answers: the document with its changes marked where they are. */
const comparison = (html: string, changes: readonly object[] = []) =>
  jsonResponse(200, {
    html,
    summary: {
      sections: 0,
      added: changes.length,
      removed: 0,
      changed: 0,
      moved: 0,
      wordsAdded: changes.length * 2,
      wordsRemoved: 0,
    },
    changes,
    sections: [],
    properties: [],
  })

const ADDED_CHANGE = {
  id: 'c1',
  change: 'added',
  block: 'p',
  excerpt: 'new line',
  wordsAdded: 2,
  wordsRemoved: 0,
}

const COMPARED_HTML = `<article><p>Kept line.</p><p data-change="added" data-change-id="c1"><ins data-diff="added"><span data-diff-label>Added: </span>new line</ins></p></article>`

const COMPARING = `${READING_PATH}?from=${'a'.repeat(40)}&to=${'b'.repeat(40)}`

describe('comparing two revisions', () => {
  it('loads the comparison on demand and draws what was added where it is', async () => {
    const { container } = renderApp(COMPARING, {
      ...readingRoutes(),
      'GET /api/documents/{id}/compare': () => comparison(COMPARED_HTML, [ADDED_CHANGE]),
    })

    expect(await screen.findByRole('heading', { name: 'Comparing v1 with v2' })).toBeInTheDocument()
    const added = await screen.findByText('new line')
    // The change is an attribute on the block, so it is what the styling and
    // the screen reader both read (docs/architecture/styling.md).
    expect(added.closest('[data-change]')).toHaveAttribute('data-change', 'added')
    expect(screen.getByText('Kept line.')).toBeInTheDocument()
    await expectNoAccessibilityViolations(container)
  })

  it('goes from one change to the next', async () => {
    HTMLElement.prototype.scrollIntoView = () => undefined
    renderApp(COMPARING, {
      ...readingRoutes(),
      'GET /api/documents/{id}/compare': () => comparison(COMPARED_HTML, [ADDED_CHANGE]),
    })

    await userEvent.click(await screen.findByRole('button', { name: 'Next change' }))

    expect((await screen.findByText('new line')).closest('[data-change]')).toHaveAttribute(
      'data-change-current',
    )
  })

  it('says so when two revisions have the same content', async () => {
    renderApp(COMPARING, {
      ...readingRoutes(),
      'GET /api/documents/{id}/compare': () => comparison('<article></article>'),
    })

    expect(await screen.findByText('No difference')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next change' })).toBeDisabled()
  })

  it('says when the comparison cannot be made', async () => {
    renderApp(COMPARING, {
      ...readingRoutes(),
      'GET /api/documents/{id}/compare': () => errorResponse(500, 'internal', 'It broke'),
    })

    expect(await screen.findByText("Couldn't compare these revisions")).toBeInTheDocument()
  })

  it('compares the two revisions a reader picks', async () => {
    renderApp(READING_PATH, {
      ...readingRoutes(),
      'GET /api/documents/{id}/compare': () => comparison(COMPARED_HTML, [ADDED_CHANGE]),
    })

    await userEvent.click(await screen.findByText('Compare', { selector: 'summary' }))
    await userEvent.selectOptions(screen.getByLabelText('From'), 'a'.repeat(40))
    await userEvent.selectOptions(screen.getByLabelText('To'), 'b'.repeat(40))
    await userEvent.click(screen.getByRole('button', { name: 'Compare' }))

    expect(await screen.findByRole('heading', { name: 'Comparing v1 with v2' })).toBeInTheDocument()
  })

  it('moves an end of the comparison when a reader picks another revision', async () => {
    renderApp(`${READING_PATH}?to=${'b'.repeat(40)}`, {
      ...readingRoutes(),
      'GET /api/documents/{id}/compare': () => comparison(COMPARED_HTML, [ADDED_CHANGE]),
    })
    expect(
      await screen.findByRole('heading', { name: 'Comparing the empty document with v2' }),
    ).toBeInTheDocument()

    await userEvent.click(await screen.findByRole('button', { name: /^From: none/ }))
    await userEvent.click(await screen.findByRole('menuitemradio', { name: /v1/ }))

    expect(await screen.findByRole('heading', { name: 'Comparing v1 with v2' })).toBeInTheDocument()
  })

  it('offers both ends of the comparison to change from the page itself', async () => {
    renderApp(COMPARING, {
      ...readingRoutes(),
      'GET /api/documents/{id}/compare': () => comparison(COMPARED_HTML, [ADDED_CHANGE]),
    })

    await userEvent.click(await screen.findByRole('button', { name: /^From: v1/ }))
    // The other end is shown and not choosable.
    expect(await screen.findByRole('menuitemradio', { name: /v2/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })
})

const leaf = (id: string, title: string, children: unknown[] = []) => ({
  id,
  shortId: `${id}`.padEnd(10, '0'),
  title,
  slug: id,
  status: 'published',
  children,
})

describe('the child-documents block when reading', () => {
  const CHILDREN_HTML = `<article>
<h1 id="regional-failover">Regional failover</h1>
<section class="live-block" data-live-block="children" aria-label="Live block: children" data-depth="2"><p>::children{depth="2"}</p></section>
</article>`

  const tree = () =>
    jsonResponse(200, {
      collections: [
        {
          id: 'col-1',
          name: 'Runbooks',
          slug: 'runbooks',
          documents: [
            leaf('doc-1', 'Regional failover', [
              leaf('primary', 'Primary region', [leaf('detail', 'Detail', [leaf('deep', 'Deep')])]),
              leaf('secondary', 'Secondary region'),
            ]),
            leaf('elsewhere', 'Somewhere else'),
          ],
        },
      ],
    })

  const routes = (overrides: FakeRoutes = {}): FakeRoutes =>
    readingRoutes({
      'GET /api/documents/{id}/rendered': () =>
        jsonResponse(200, {
          revision: 'b'.repeat(40),
          html: CHILDREN_HTML,
          outline: [{ id: 'regional-failover', depth: 1, text: 'Regional failover', children: [] }],
          slots: [],
        }),
      'GET /api/workspaces/{id}/tree': tree,
      ...overrides,
    })

  it('lists the documents beneath this one as links, as deep as the block asks', async () => {
    renderApp(READING_PATH, routes())

    const block = await screen.findByRole('region', { name: 'Child documents' })
    expect(await within(block).findByRole('link', { name: 'Primary region' })).toBeVisible()
    expect(
      within(block)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Primary region', 'Detail', 'Secondary region'])
    // Its own address, and not a sibling's.
    expect(within(block).queryByText('Somewhere else')).toBeNull()
    expect(within(block).queryByText('::children{depth="2"}')).toBeNull()
  })

  it('links to each document by its address (ADR-035)', async () => {
    renderApp(READING_PATH, routes())
    const block = await screen.findByRole('region', { name: 'Child documents' })
    expect(await within(block).findByRole('link', { name: 'Secondary region' })).toHaveAttribute(
      'href',
      '/w/acme/d/secondary-region-secondary0',
    )
  })

  it('says so when there are none', async () => {
    renderApp(
      READING_PATH,
      routes({
        'GET /api/workspaces/{id}/tree': () =>
          jsonResponse(200, {
            collections: [
              {
                id: 'col-1',
                name: 'Runbooks',
                slug: 'runbooks',
                documents: [leaf('doc-1', 'Regional failover')],
              },
            ],
          }),
      }),
    )
    const block = await screen.findByRole('region', { name: 'Child documents' })
    expect(await within(block).findByText('This document has no child documents.')).toBeVisible()
  })

  it('draws nothing until the tree has arrived, rather than claiming there are none', async () => {
    renderApp(
      READING_PATH,
      routes({ 'GET /api/workspaces/{id}/tree': () => new Promise<Response>(() => {}) }),
    )
    const block = await screen.findByRole('region', { name: 'Child documents' })
    expect(block).toBeEmptyDOMElement()
  })
})
