import { parseDocument } from '@quill/markdown'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

import type {
  EditorLinkPreview,
  LinkPreviewSource,
  LinkPreviewState,
  LinkRefreshOutcome,
} from '../blocks/link-preview-context.tsx'
import { DocumentEditor } from '../document/document-editor.tsx'
import type { DocumentEditorHandle } from '../document/document-editor.tsx'
import { expectNoAccessibilityViolations } from '../testing/axe.ts'

const ADDRESS = 'https://blog.example/post'
const TWO_DAYS_AGO = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()

const preview = (overrides: Partial<EditorLinkPreview> = {}): EditorLinkPreview => ({
  title: 'How we cut build times',
  description: null,
  siteName: 'Engineering blog',
  thumbnail: null,
  favicon: null,
  layer: 'open-graph',
  fetchedAt: TWO_DAYS_AGO,
  ...overrides,
})

interface SourceOptions {
  readonly state?: LinkPreviewState | null
  readonly preview?: EditorLinkPreview | null
  readonly publicSite?: boolean
  readonly refresh?: (() => Promise<LinkRefreshOutcome>) | null
  readonly refreshing?: boolean
}

function sourceOf(
  options: SourceOptions = {},
): LinkPreviewSource & { request: Mock<(url: string) => void> } {
  const refresh = options.refresh === undefined ? async () => 'started' as const : options.refresh
  return {
    preview: () => (options.preview === undefined ? preview() : options.preview),
    request: vi.fn<(url: string) => void>(),
    imageUrl: () => '',
    state: () => (options.state === undefined ? 'ready' : options.state),
    ...(refresh === null ? {} : { refresh }),
    refreshing: options.refreshing ?? false,
    ...(options.publicSite === undefined ? {} : { publicSite: options.publicSite }),
  }
}

/** A document with the link in the middle of a sentence, the caret inside the link. */
function openWithCaretInLink(source: LinkPreviewSource, markdown = `See [the post](${ADDRESS}) now.`) {
  const ref = createRef<DocumentEditorHandle>()
  const result = render(
    <DocumentEditor ast={parseDocument(markdown).ast} ref={ref} linkPreviews={source} />,
  )
  const editor = ref.current?.editor
  if (editor === null || editor === undefined) throw new Error('The editor did not mount.')
  act(() => {
    editor.view.focus()
    editor.chain().setTextSelection(7).run()
  })
  return { ...result, editor, user: userEvent.setup() }
}

const toolbar = () => screen.getByRole('toolbar', { name: 'Link' })

describe('the toolbar’s line about a link’s preview', () => {
  it('says where the preview came from and how old it is', async () => {
    const opened = openWithCaretInLink(sourceOf())
    const line = within(toolbar()).getByText(/Open Graph, fetched/u)
    expect(line).toHaveTextContent('Open Graph, fetched 2 days ago')
    await expectNoAccessibilityViolations(opened.container)
  })

  it.each([
    ['connector', 'Connector'],
    ['oembed', 'oEmbed'],
    ['twitter-card', 'Twitter Card'],
    ['page', 'The page itself'],
  ])('names the %s layer in words', (layer, words) => {
    openWithCaretInLink(sourceOf({ preview: preview({ layer }) }))
    expect(within(toolbar()).getByText(new RegExp(`^${words}, fetched`, 'u'))).toBeVisible()
  })

  it('tells the application which address it is looking at, so the answer can be found', () => {
    const source = sourceOf()
    openWithCaretInLink(source)
    expect(source.request).toHaveBeenCalledWith(ADDRESS)
  })

  it('warns when the organisation shows no previews on the public site', () => {
    openWithCaretInLink(sourceOf({ publicSite: false }))
    expect(within(toolbar()).getByText(/Not shown on the public site/u)).toHaveTextContent(
      'your organisation turned previews off there',
    )
  })

  it('warns when the preview came from a layer the public site does not use', () => {
    openWithCaretInLink(sourceOf({ preview: preview({ layer: 'connector' }) }))
    expect(within(toolbar()).getByText(/Not shown on the public site/u)).toHaveTextContent(
      'only members can see it',
    )
  })

  it('does not warn when the public site will show it', () => {
    openWithCaretInLink(sourceOf({ publicSite: true }))
    expect(within(toolbar()).queryByText(/Not shown on the public site/u)).toBeNull()
  })

  it('says the preview is on its way while it is pending', () => {
    openWithCaretInLink(sourceOf({ state: 'pending', preview: null }))
    expect(within(toolbar()).getByText('Fetching the preview…')).toBeVisible()
    expect(within(toolbar()).queryByRole('button', { name: 'Refresh preview' })).toBeNull()
  })

  it('says the organisation does not show a blocked link’s preview, and offers nothing to retry', () => {
    openWithCaretInLink(sourceOf({ state: 'blocked', preview: null }))
    expect(
      within(toolbar()).getByText('Your organisation does not show previews for this link.'),
    ).toBeVisible()
    expect(within(toolbar()).queryByRole('button', { name: /Retry|Refresh/u })).toBeNull()
  })

  it('says "Preview unavailable" with a Retry, never an error in the page', async () => {
    const refresh = vi.fn(async () => 'started' as const)
    const opened = openWithCaretInLink(sourceOf({ state: 'unavailable', preview: null, refresh }))
    expect(within(toolbar()).getByText('Preview unavailable.')).toBeVisible()
    await opened.user.click(within(toolbar()).getByRole('button', { name: 'Retry' }))
    expect(refresh).toHaveBeenCalledWith(ADDRESS)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('has nothing to say when the application cannot tell', () => {
    const quiet: LinkPreviewSource = { preview: () => null, request: () => undefined, imageUrl: () => '' }
    openWithCaretInLink(quiet)
    expect(within(toolbar()).queryByText(/preview/iu)).toBeNull()
  })
})

describe('refreshing a preview from the toolbar', () => {
  it('asks the application for the address under the caret', async () => {
    const refresh = vi.fn(async () => 'started' as const)
    const opened = openWithCaretInLink(sourceOf({ refresh }))
    await opened.user.click(within(toolbar()).getByRole('button', { name: 'Refresh preview' }))
    expect(refresh).toHaveBeenCalledExactlyOnceWith(ADDRESS)
  })

  it('is reachable with the keyboard, like every control on the toolbar', async () => {
    const refresh = vi.fn(async () => 'started' as const)
    const opened = openWithCaretInLink(sourceOf({ refresh }))
    within(toolbar()).getByRole('button', { name: 'Refresh preview' }).focus()
    await opened.user.keyboard('{Enter}')
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('is disabled and says so while a refresh is in flight', () => {
    openWithCaretInLink(sourceOf({ refreshing: true }))
    const button = within(toolbar()).getByRole('button', { name: 'Refreshing…' })
    expect(button).toBeDisabled()
  })

  it.each([
    ['rate_limited', 'Refreshing too often. Try again in a few seconds.'],
    ['blocked', 'Your organisation does not allow previews of this link.'],
    ['failed', 'The preview could not be refreshed just now. The link still works.'],
  ] as const)('answers %s quietly, as a status, not an alert', async (outcome, words) => {
    const opened = openWithCaretInLink(sourceOf({ refresh: async () => outcome }))
    await opened.user.click(within(toolbar()).getByRole('button', { name: 'Refresh preview' }))
    expect(await within(toolbar()).findByRole('status')).toHaveTextContent(words)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows no refresh when the application does not offer one', () => {
    openWithCaretInLink(sourceOf({ refresh: null }))
    expect(within(toolbar()).queryByRole('button', { name: /Refresh|Retry/u })).toBeNull()
    expect(within(toolbar()).getByText(/Open Graph, fetched/u)).toBeVisible()
  })

  it('does not change the document', async () => {
    const opened = openWithCaretInLink(sourceOf())
    const before = opened.editor.state.doc
    await opened.user.click(within(toolbar()).getByRole('button', { name: 'Refresh preview' }))
    expect(opened.editor.state.doc.eq(before)).toBe(true)
  })
})
