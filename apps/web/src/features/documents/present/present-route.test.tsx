import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { packRanges } from '@quill/highlight'
import { expectNoAccessibilityViolations } from '@quill/ui/testing/axe'

import { renderApp } from '../../../lib/api/render-app.tsx'
import { errorResponse, jsonResponse, type FakeRoutes } from '../../../lib/api/testing.ts'

const me = () =>
  jsonResponse(200, {
    id: 'user-1',
    email: 'presenter@example.com',
    displayName: 'Presenter',
    emailVerified: true,
    isInstanceAdmin: false,
  })

const document = () =>
  jsonResponse(200, {
    id: 'doc-1',
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
const TOKENS = packRanges([{ start: 0, end: 6, type: 'keyword' }])

/** A body in the shape the Markdown renderer emits (see `document-page.test.tsx`). */
const BODY_HTML = `<article>
<h1 id="failover">Regional failover<a class="heading-anchor" href="#failover" aria-label="Permalink: Regional failover">#</a></h1>
<p>How to move traffic between regions.</p>
<h2 id="steps">Steps<a class="heading-anchor" href="#steps" aria-label="Permalink: Steps">#</a></h2>
<pre><code data-lang="ts" data-tokens="${TOKENS}">${CODE}</code></pre>
<div class="layout-wide"><table><thead><tr><th scope="col">Region</th></tr></thead><tbody><tr><td>eu</td></tr></tbody></table></div>
<h2 id="afterwards">Afterwards<a class="heading-anchor" href="#afterwards" aria-label="Permalink: Afterwards">#</a></h2>
<p>Tell the on-call engineer.</p>
</article>`

const rendered = () =>
  jsonResponse(200, {
    revision: 'b'.repeat(40),
    html: BODY_HTML,
    outline: [
      {
        id: 'failover',
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

const content = () =>
  jsonResponse(200, {
    revision: 'b'.repeat(40),
    frontMatter: { title: 'Regional failover' },
    markdown: [
      '# Regional failover',
      '',
      '## Steps',
      '',
      ':::notes',
      'Pause after the table.',
      ':::',
      '',
      '## Afterwards',
      '',
    ].join('\n'),
  })

function presentRoutes(overrides: FakeRoutes = {}): FakeRoutes {
  return {
    'GET /api/me': me,
    'GET /api/documents/{id}': document,
    'GET /api/documents/{id}/rendered': rendered,
    'GET /api/documents/{id}/content': content,
    ...overrides,
  }
}

/** The section a room is looking at: the one `<section>` that is not hidden. */
function onScreen(): HTMLElement {
  const shown = [...globalThis.document.querySelectorAll('main > section')].find(
    (section) => !section.hasAttribute('hidden'),
  )
  if (!(shown instanceof HTMLElement)) throw new Error('No step is on screen')
  return shown
}

describe('presenting a document', () => {
  it('opens on the document’s title, with the sections as steps', async () => {
    const { container } = renderApp('/w/acme/d/doc-1/present', presentRoutes())

    await screen.findByRole('region', { name: 'Regional failover' })
    expect(onScreen()).toHaveAccessibleName('Regional failover')
    expect(within(onScreen()).getByText('How to move traffic between regions.')).toBeInTheDocument()

    const rail = screen.getByRole('navigation', { name: 'Sections' })
    expect(within(rail).getAllByRole('button')).toHaveLength(3)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', 'Section 1 of 3')
    await expectNoAccessibilityViolations(container)
  })

  it('mounts the same renderer output the reading view does, breakouts and highlighting intact', async () => {
    renderApp('/w/acme/d/doc-1/present?step=2', presentRoutes())

    const step = await screen.findByRole('region', { name: 'Steps' })
    const article = within(step).getByRole('article', { name: 'Steps' })

    expect(article.querySelector(':scope > .layout-wide')).not.toBeNull()
    expect(article.querySelector('code')?.querySelectorAll('.tok-keyword')).toHaveLength(1)
    expect(article.querySelector('.table-scroll')).toHaveAttribute('role', 'group')
  })

  it('steps with the keyboard, and the URL follows', async () => {
    const { router } = renderApp('/w/acme/d/doc-1/present', presentRoutes())
    await screen.findByRole('region', { name: 'Regional failover' })

    await userEvent.keyboard('{ArrowRight}')
    await waitFor(() => expect(router.state.location.search).toEqual({ step: 2 }))
    expect(onScreen()).toHaveAccessibleName('Steps')

    await userEvent.keyboard('{PageDown}')
    await waitFor(() => expect(onScreen()).toHaveAccessibleName('Afterwards'))

    // The end is the end: forward again stays put rather than wrapping.
    await userEvent.keyboard('{ArrowRight}')
    expect(onScreen()).toHaveAccessibleName('Afterwards')

    await userEvent.keyboard('{Home}')
    await waitFor(() => expect(onScreen()).toHaveAccessibleName('Regional failover'))
    expect(router.state.location.search).toEqual({ step: 1 })
  })

  it('lands a shared link on the section it names', async () => {
    renderApp('/w/acme/d/doc-1/present?step=3', presentRoutes())

    await screen.findByRole('region', { name: 'Afterwards' })
    expect(onScreen()).toHaveAccessibleName('Afterwards')
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', 'Section 3 of 3')
  })

  it('moves focus to the section and announces it', async () => {
    renderApp('/w/acme/d/doc-1/present', presentRoutes())
    await screen.findByRole('region', { name: 'Regional failover' })

    await userEvent.keyboard('{End}')

    await waitFor(() => expect(onScreen()).toHaveFocus())
    expect(screen.getByText('Section 3 of 3: Afterwards')).toBeInTheDocument()
  })

  it('jumps to a section from the rail', async () => {
    renderApp('/w/acme/d/doc-1/present', presentRoutes())
    const rail = await screen.findByRole('navigation', { name: 'Sections' })

    await userEvent.click(within(rail).getByRole('button', { name: 'Section 2: Steps' }))

    await waitFor(() => expect(onScreen()).toHaveAccessibleName('Steps'))
  })

  it('opens the go-to overlay with `g` and goes where it is told', async () => {
    renderApp('/w/acme/d/doc-1/present', presentRoutes())
    await screen.findByRole('region', { name: 'Regional failover' })

    await userEvent.keyboard('g')
    const overlay = await screen.findByRole('dialog', { name: 'Go to a section' })

    await userEvent.keyboard('after{Enter}')

    await waitFor(() => expect(overlay).not.toBeInTheDocument())
    expect(onScreen()).toHaveAccessibleName('Afterwards')
  })

  it('does not step while the overlay has the keyboard', async () => {
    renderApp('/w/acme/d/doc-1/present', presentRoutes())
    await screen.findByRole('region', { name: 'Regional failover' })

    await userEvent.keyboard('g')
    await screen.findByRole('dialog', { name: 'Go to a section' })
    await userEvent.keyboard('{ArrowRight}')

    expect(onScreen()).toHaveAccessibleName('Regional failover')

    await userEvent.keyboard('{Escape}')
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Go to a section' })).not.toBeInTheDocument(),
    )
    // Escape closed the overlay, not the presentation.
    expect(onScreen()).toHaveAccessibleName('Regional failover')
  })

  it('shows the presenter notes of the section on screen, and only to the presenter', async () => {
    renderApp('/w/acme/d/doc-1/present?step=2', presentRoutes())
    await screen.findByRole('region', { name: 'Steps' })

    expect(screen.queryByRole('complementary', { name: 'Presenter notes' })).not.toBeInTheDocument()

    await userEvent.keyboard('n')
    const panel = await screen.findByRole('complementary', { name: 'Presenter notes' })

    expect(await within(panel).findByText('Pause after the table.')).toBeInTheDocument()
    // Never in the document the room is reading.
    expect(within(onScreen()).queryByText('Pause after the table.')).not.toBeInTheDocument()

    await userEvent.keyboard('n')
    await waitFor(() => expect(panel).not.toBeInTheDocument())
  })

  it('says so, rather than showing an empty card, when a section has no notes', async () => {
    renderApp('/w/acme/d/doc-1/present?step=3', presentRoutes())
    await screen.findByRole('region', { name: 'Afterwards' })

    await userEvent.keyboard('n')
    const panel = await screen.findByRole('complementary', { name: 'Presenter notes' })

    expect(await within(panel).findByText(/No presenter notes for this section/)).toBeVisible()
    // Nothing interactive is inert: what M4 will build is disabled with its
    // reason beside it (`docs/design/feedback.md`).
    expect(within(panel).getByRole('button', { name: 'Note for later' })).toBeDisabled()
    expect(within(panel).getByText(/Capturing notes arrives with comments/)).toBeVisible()
  })

  it('leaves for the reading view, at the section that was on screen', async () => {
    const { router } = renderApp('/w/acme/d/doc-1/present?step=2', presentRoutes())
    await screen.findByRole('region', { name: 'Steps' })

    await userEvent.keyboard('{Escape}')

    await waitFor(() => expect(router.state.location.pathname).toBe('/w/acme/d/doc-1'))
    expect(router.state.location.hash).toBe('steps')
  })

  it('offers Exit as a link, not a key nobody can see', async () => {
    renderApp('/w/acme/d/doc-1/present', presentRoutes())

    expect(await screen.findByRole('link', { name: 'Exit' })).toHaveAttribute(
      'href',
      '/w/acme/d/doc-1#failover',
    )
  })

  it('says a document has to be published before it can be presented', async () => {
    renderApp(
      '/w/acme/d/doc-1/present',
      presentRoutes({
        'GET /api/documents/{id}/rendered': () =>
          errorResponse(404, 'not_found', 'This document has never been published'),
      }),
    )

    expect(await screen.findByText('Nothing published yet')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to the document' })).toHaveAttribute(
      'href',
      '/w/acme/d/doc-1',
    )
  })
})
