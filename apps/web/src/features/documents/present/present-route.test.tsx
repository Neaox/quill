/* oxlint-disable unicorn/require-post-message-target-origin -- a `BroadcastChannel` has no target origin: it is the origin's own. */
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { presentChannelName } from './present-channel.ts'

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
<p>See <a href="https://example.com/runbook">the runbook</a> and <img src="/api/attachments/a" alt="The architecture"> here.</p>
<div class="layout-wide"><div class="table-scroll" tabindex="0" role="group" aria-label="Table"><table><thead><tr><th scope="col">Region</th></tr></thead><tbody><tr><td>eu</td></tr></tbody></table></div></div>
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

/** jsdom has no modal dialogs and no pointer capture, which the picture viewer uses. */
function showModal(this: HTMLDialogElement): void {
  this.setAttribute('open', '')
}

function closeModal(this: HTMLDialogElement): void {
  this.removeAttribute('open')
  this.dispatchEvent(new Event('close'))
}

function standInForModalDialogs(): void {
  HTMLDialogElement.prototype.showModal = showModal
  HTMLDialogElement.prototype.close = closeModal
  Element.prototype.setPointerCapture = () => undefined
}

/** The black overlay, while the room's screen is blank. */
const blankedScreen = () => screen.queryByRole('button', { name: 'Bring the screen back' })

/** A page 3000 tall in a window 1000 tall, which a test has no layout to say. */
function aTallPage(): HTMLElement {
  const page = globalThis.document.documentElement
  Object.defineProperty(globalThis.document, 'scrollingElement', {
    value: page,
    configurable: true,
  })
  Object.defineProperty(page, 'scrollHeight', { value: 3000, configurable: true })
  Object.defineProperty(page, 'clientHeight', { value: 1000, configurable: true })
  page.scrollTop = 0
  return page
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
    // The enhancers arrive as chunks of their own, so they land a moment after the body.
    await waitFor(() => {
      expect(article.querySelector('code')?.querySelectorAll('.tok-keyword')).toHaveLength(1)
    })
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

  describe('up and down, when a section is taller than the window', () => {
    afterEach(() => {
      Reflect.deleteProperty(globalThis.document, 'scrollingElement')
      Reflect.deleteProperty(globalThis.document.documentElement, 'scrollHeight')
      Reflect.deleteProperty(globalThis.document.documentElement, 'clientHeight')
    })

    it('goes to the next and previous section with the arrows when the section fits', async () => {
      renderApp('/w/acme/d/doc-1/present', presentRoutes())
      await screen.findByRole('region', { name: 'Regional failover' })

      await userEvent.keyboard('{ArrowDown}')
      await waitFor(() => expect(onScreen()).toHaveAccessibleName('Steps'))

      await userEvent.keyboard('{ArrowUp}')
      await waitFor(() => expect(onScreen()).toHaveAccessibleName('Regional failover'))
    })

    it('scrolls the section first, and only at its foot goes on to the top of the next', async () => {
      const page = aTallPage()
      renderApp('/w/acme/d/doc-1/present', presentRoutes())
      await screen.findByRole('region', { name: 'Regional failover' })

      await userEvent.keyboard('{PageDown}')
      expect(page.scrollTop).toBe(900)
      expect(onScreen()).toHaveAccessibleName('Regional failover')

      page.scrollTop = 2000
      await userEvent.keyboard('{PageDown}')

      await waitFor(() => expect(onScreen()).toHaveAccessibleName('Steps'))
      expect(page.scrollTop).toBe(0)
    })

    it('scrolls back up through a section, and at its top arrives at the foot of the previous', async () => {
      const page = aTallPage()
      renderApp('/w/acme/d/doc-1/present?step=2', presentRoutes())
      await screen.findByRole('region', { name: 'Steps' })
      page.scrollTop = 1500

      await userEvent.keyboard('{ArrowUp}')
      expect(page.scrollTop).toBe(1452)
      expect(onScreen()).toHaveAccessibleName('Steps')

      page.scrollTop = 0
      await userEvent.keyboard('{ArrowUp}')

      await waitFor(() => expect(onScreen()).toHaveAccessibleName('Regional failover'))
      expect(page.scrollTop).toBe(2000)
    })

    it('goes straight to the top of the other section with left and right, wherever it was', async () => {
      const page = aTallPage()
      renderApp('/w/acme/d/doc-1/present?step=2', presentRoutes())
      await screen.findByRole('region', { name: 'Steps' })
      page.scrollTop = 1500

      await userEvent.keyboard('{ArrowLeft}')

      await waitFor(() => expect(onScreen()).toHaveAccessibleName('Regional failover'))
      expect(page.scrollTop).toBe(0)
    })

    it('does not run on through the deck while a key that scrolls is held', async () => {
      renderApp('/w/acme/d/doc-1/present', presentRoutes())
      await screen.findByRole('region', { name: 'Regional failover' })

      await userEvent.keyboard('{ArrowDown>3/}')

      // One press stepped; the held repeats scrolled nothing and went nowhere.
      expect(onScreen()).toHaveAccessibleName('Steps')
    })
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

  it('never draws the notes in the window the room sees, whatever is pressed', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    renderApp('/w/acme/d/doc-1/present?step=2', presentRoutes())
    await screen.findByRole('region', { name: 'Steps' })

    await userEvent.keyboard('n')

    // `n` opens the presenter view, in a window of its own, and draws nothing here.
    expect(open).toHaveBeenCalledWith(
      expect.stringContaining('view=presenter'),
      expect.any(String),
      expect.stringContaining('popup'),
    )
    expect(screen.queryByRole('complementary', { name: 'Presenter notes' })).not.toBeInTheDocument()
    expect(screen.queryByText('Pause after the table.')).not.toBeInTheDocument()
    open.mockRestore()
  })

  it('opens the presenter view at the step the room is on, from the bar or from `p`', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    renderApp('/w/acme/d/doc-1/present?step=2', presentRoutes())
    await screen.findByRole('region', { name: 'Steps' })

    await userEvent.click(screen.getByRole('button', { name: 'Presenter view' }))

    expect(open).toHaveBeenCalledWith(
      expect.stringMatching(/present\?step=2&view=presenter|present\?view=presenter&step=2/u),
      expect.any(String),
      expect.any(String),
    )
    open.mockRestore()
  })

  it('says which way it is presenting, and says so when the browser blocks the window', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    renderApp('/w/acme/d/doc-1/present?step=1', presentRoutes())
    await screen.findByRole('region', { name: 'Regional failover' })

    const single = screen.getByRole('button', { name: 'Single window' })
    expect(single).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Presenter view' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )

    await userEvent.click(screen.getByRole('button', { name: 'Presenter view' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/blocked the window/u)
    open.mockRestore()
  })

  it('follows the other window of the presentation when it moves', async () => {
    const { router } = renderApp('/w/acme/d/doc-1/present?step=1', presentRoutes())
    await screen.findByRole('region', { name: 'Regional failover' })
    // The presenter window, on the same channel, the same document and the same revision.
    const other = new BroadcastChannel(presentChannelName('doc-1'))

    other.postMessage({
      type: 'step',
      index: 2,
      revision: 'b'.repeat(40),
      from: 'presenter-window',
    })

    expect(await screen.findByRole('region', { name: 'Afterwards' })).toBeVisible()
    await waitFor(() => {
      expect(router.state.location.search).toMatchObject({ step: 3 })
    })
    other.close()
  })

  it('tells the other window when it moves, and does not take a step from another version', async () => {
    renderApp('/w/acme/d/doc-1/present?step=1', presentRoutes())
    await screen.findByRole('region', { name: 'Regional failover' })
    const other = new BroadcastChannel(presentChannelName('doc-1'))
    const heard: unknown[] = []
    other.addEventListener('message', (event: MessageEvent<unknown>) => {
      heard.push(event.data)
    })

    await userEvent.keyboard('{ArrowRight}')

    await waitFor(() => {
      expect(heard).toContainEqual(
        expect.objectContaining({ type: 'step', index: 1, revision: 'b'.repeat(40) }),
      )
    })
    // A step from a different version of the document is not followed.
    other.postMessage({
      type: 'step',
      index: 2,
      revision: 'c'.repeat(40),
      from: 'presenter-window',
    })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(onScreen()).toHaveAccessibleName('Steps')
    other.close()
  })

  describe('the black screen', () => {
    it('goes black on `b`, says so in words, and comes back on `b` again', async () => {
      renderApp('/w/acme/d/doc-1/present?step=2', presentRoutes())
      await screen.findByRole('region', { name: 'Steps' })
      expect(blankedScreen()).not.toBeInTheDocument()

      await userEvent.keyboard('b')

      expect(blankedScreen()).toBeInTheDocument()
      expect(screen.getByRole('status')).toHaveTextContent(/Screen blanked/u)
      await userEvent.keyboard('.')
      expect(blankedScreen()).not.toBeInTheDocument()
    })

    it('comes back on Escape without leaving the presentation', async () => {
      const { router } = renderApp('/w/acme/d/doc-1/present?step=2', presentRoutes())
      await screen.findByRole('region', { name: 'Steps' })

      await userEvent.keyboard('b')
      await userEvent.keyboard('{Escape}')

      expect(blankedScreen()).not.toBeInTheDocument()
      expect(router.state.location.pathname).toMatch(/\/present$/u)
    })

    it('comes back on the next press, and goes on to the next section', async () => {
      const { router } = renderApp('/w/acme/d/doc-1/present?step=1', presentRoutes())
      await screen.findByRole('region', { name: 'Regional failover' })

      await userEvent.keyboard('b')
      await userEvent.keyboard('{ArrowRight}')

      expect(blankedScreen()).not.toBeInTheDocument()
      await waitFor(() => {
        expect(router.state.location.search).toMatchObject({ step: 2 })
      })
    })

    it('comes back when it is clicked', async () => {
      renderApp('/w/acme/d/doc-1/present?step=1', presentRoutes())
      await screen.findByRole('region', { name: 'Regional failover' })
      await userEvent.keyboard('b')

      await userEvent.click(screen.getByRole('button', { name: 'Bring the screen back' }))

      expect(blankedScreen()).not.toBeInTheDocument()
    })

    it('follows the presenter window, which can blank the room from where it is', async () => {
      renderApp('/w/acme/d/doc-1/present?step=1', presentRoutes())
      await screen.findByRole('region', { name: 'Regional failover' })
      const other = new BroadcastChannel(presentChannelName('doc-1'))

      other.postMessage({ type: 'blank', blank: true, from: 'presenter-window' })

      expect(
        await screen.findByRole('button', { name: 'Bring the screen back' }),
      ).toBeInTheDocument()
      other.close()
    })

    it('has a button in the presenter window, which says whether the room is black', async () => {
      renderApp('/w/acme/d/doc-1/present?step=1&view=presenter', presentRoutes())
      const button = await screen.findByRole('button', { name: 'Black screen' })
      expect(button).toHaveAttribute('aria-pressed', 'false')

      await userEvent.click(button)

      expect(button).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByText('Room’s screen is black')).toBeInTheDocument()
      // The presenter's own screen is never the one that goes black.
      expect(
        screen.queryByRole('button', { name: 'Bring the screen back' }),
      ).not.toBeInTheDocument()
    })
  })

  describe('the presenter window', () => {
    it('shows the notes for the section being presented, what is next, and a clock', async () => {
      renderApp('/w/acme/d/doc-1/present?step=2&view=presenter', presentRoutes())

      const panel = await screen.findByRole('complementary', { name: 'Presenter notes' })

      expect(await within(panel).findByText('Pause after the table.')).toBeInTheDocument()
      expect(screen.getByText(/Now showing · Steps/u)).toBeInTheDocument()
      expect(screen.getByText(/Next · Afterwards/u)).toBeInTheDocument()
      expect(screen.getByText('Section 2 of 3')).toBeInTheDocument()
      expect(screen.getByText('0:00')).toBeInTheDocument()
    })

    it('says so, rather than showing an empty card, when a section has no notes', async () => {
      renderApp('/w/acme/d/doc-1/present?step=3&view=presenter', presentRoutes())

      const panel = await screen.findByRole('complementary', { name: 'Presenter notes' })

      expect(await within(panel).findByText(/No presenter notes for this section/u)).toBeVisible()
      // What M4 will build is disabled with its reason beside it (`docs/design/feedback.md`).
      expect(within(panel).getByRole('button', { name: 'Note for later' })).toBeDisabled()
      expect(screen.getByText('This is the last section.')).toBeInTheDocument()
    })

    it('says whether a section has notes to make room for, so the slides can have the room when it has none', async () => {
      const { unmount } = renderApp(
        '/w/acme/d/doc-1/present?step=2&view=presenter',
        presentRoutes(),
      )
      await screen.findByRole('complementary', { name: 'Presenter notes' })
      expect(globalThis.document.querySelector('.presenter-stage')).toHaveAttribute(
        'data-notes',
        'some',
      )
      unmount()

      renderApp('/w/acme/d/doc-1/present?step=3&view=presenter', presentRoutes())
      await screen.findByText(/No presenter notes for this section/u)
      expect(globalThis.document.querySelector('.presenter-stage')).toHaveAttribute(
        'data-notes',
        'none',
      )
      // One line, not a panel: it is marked so the stylesheet gives the room to the slides.
      expect(screen.getByRole('complementary', { name: 'Presenter notes' })).toHaveAttribute(
        'data-bare',
        'true',
      )
    })

    it('lets the presenter use the section being shown, and only that one', async () => {
      renderApp('/w/acme/d/doc-1/present?step=1&view=presenter', presentRoutes())
      const next = await screen.findByRole('region', { name: 'Next' })
      // What is only a picture of what is coming is inert, and not read out a second time.
      const coming = next.querySelector('.presenter-slide')
      expect(coming).toHaveAttribute('aria-hidden', 'true')
      expect(coming).not.toHaveAttribute('data-live')
      expect(within(next).queryByRole('button', { name: /Open image/u })).toBeNull()
    })

    it('opens the pictures of the section being shown, which a presenter sharing this window has no other way to enlarge', async () => {
      standInForModalDialogs()
      const { router } = renderApp('/w/acme/d/doc-1/present?step=2&view=presenter', presentRoutes())
      const now = await screen.findByRole('region', { name: 'Now showing' })

      const picture = await within(now).findByRole('button', {
        name: 'Open image: The architecture',
      })
      await userEvent.click(picture)

      expect(globalThis.document.querySelector('dialog.lightbox[open]')).not.toBeNull()
      // Keys in the viewer are the viewer's: the arrows pan it and Escape closes it, and none steps
      // the presentation or closes its window.
      const close = vi.spyOn(window, 'close').mockReturnValue(undefined)
      await userEvent.keyboard('{ArrowRight}{Escape}')
      expect(close).not.toHaveBeenCalled()
      close.mockRestore()
      expect(router.state.location.search).toMatchObject({ step: 2, view: 'presenter' })
      expect(router.state.location.pathname).toMatch(/present$/u)
    })

    it('presses a focused picture with Space rather than stepping to the next section', async () => {
      standInForModalDialogs()
      const { router } = renderApp('/w/acme/d/doc-1/present?step=2&view=presenter', presentRoutes())
      const picture = await screen.findByRole('button', { name: 'Open image: The architecture' })

      picture.focus()
      await userEvent.keyboard(' ')

      expect(globalThis.document.querySelector('dialog.lightbox')).not.toBeNull()
      expect(router.state.location.search).toMatchObject({ step: 2 })
    })

    it('opens a link in the slide beside the presentation, never in place of it', async () => {
      const open = vi.spyOn(window, 'open').mockReturnValue(null)
      const { router } = renderApp('/w/acme/d/doc-1/present?step=2&view=presenter', presentRoutes())
      const now = await screen.findByRole('region', { name: 'Now showing' })

      await userEvent.click(await within(now).findByRole('link', { name: 'the runbook' }))

      expect(open).toHaveBeenCalledWith(
        'https://example.com/runbook',
        '_blank',
        'noopener,noreferrer',
      )
      expect(router.state.location.search).toMatchObject({ view: 'presenter' })
      open.mockRestore()
    })

    it('keeps a link to a place in the section in the section', async () => {
      const open = vi.spyOn(window, 'open').mockReturnValue(null)
      renderApp('/w/acme/d/doc-1/present?step=2&view=presenter', presentRoutes())
      const now = await screen.findByRole('region', { name: 'Now showing' })
      const anchor = globalThis.document.createElement('a')
      anchor.href = '#steps'
      anchor.textContent = 'back up'
      now.querySelector('.presenter-slide')?.append(anchor)

      await userEvent.click(anchor)

      expect(open).not.toHaveBeenCalled()
      open.mockRestore()
    })

    it('steps with its buttons, and the URL follows', async () => {
      const { router } = renderApp('/w/acme/d/doc-1/present?step=1&view=presenter', presentRoutes())
      await screen.findByRole('complementary', { name: 'Presenter notes' })

      await userEvent.click(screen.getByRole('button', { name: 'Next' }))

      await waitFor(() => {
        expect(router.state.location.search).toMatchObject({ step: 2, view: 'presenter' })
      })
    })

    it('says there is no audience window yet, and offers to open one', async () => {
      const open = vi.spyOn(window, 'open').mockReturnValue(null)
      renderApp('/w/acme/d/doc-1/present?step=2&view=presenter', presentRoutes())
      await screen.findByRole('complementary', { name: 'Presenter notes' })

      expect(screen.getByText('No audience window')).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Open audience window' }))

      expect(open).toHaveBeenCalledWith(
        expect.not.stringContaining('view=presenter'),
        expect.any(String),
        undefined,
      )
      open.mockRestore()
    })
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
