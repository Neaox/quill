import { BRAND } from '@quill/brand'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'

import { ApiClientProvider } from '../../../lib/api/client-context.tsx'
import { createFakeApiClient, jsonResponse } from '../../../lib/api/testing.ts'
import { LinkPeek } from './link-peek.tsx'
import { PEEK_OPEN_DELAY_MS } from './use-link-peek.ts'

const URL_A = 'https://blog.example/post'
const PREVIEW = {
  url: URL_A,
  canonicalUrl: URL_A,
  title: 'How we cut build times',
  description: 'Caching and parallelism.',
  siteName: 'Engineering blog',
  kind: 'article',
  thumbnail: null,
  favicon: null,
  layer: 'open-graph',
  fetchedAt: '2026-01-01T00:00:00.000Z',
}
const READY = { state: 'ready', preview: PREVIEW, stale: false }

function Page({ view }: { readonly view: unknown }) {
  const host = useRef<HTMLDivElement | null>(null)
  const client = createFakeApiClient({
    'POST /api/link-previews/resolve': () =>
      jsonResponse(200, { previews: [{ url: URL_A, view }] }),
  })
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <ApiClientProvider client={client}>
      <QueryClientProvider client={queries}>
        <div ref={host}>
          <p>
            Read <a href={URL_A}>the post</a>.
          </p>
        </div>
        <LinkPeek host={host} />
      </QueryClientProvider>
    </ApiClientProvider>
  )
}

function rest(link: HTMLElement) {
  const event = new MouseEvent('pointerover', { bubbles: true })
  Object.defineProperty(event, 'pointerType', { value: 'mouse' })
  act(() => {
    link.dispatchEvent(event)
  })
}

const pastTheDelay = () =>
  act(() => new Promise((done) => setTimeout(done, PEEK_OPEN_DELAY_MS + 300)))

beforeEach(() => {
  localStorage.clear()
})

describe('LinkPeek', () => {
  it('shows the page a link goes to once the pointer has rested on it, and describes the link with it', async () => {
    render(<Page view={READY} />)
    const link = screen.getByRole('link', { name: 'the post' })
    expect(screen.queryByRole('tooltip')).toBeNull()

    rest(link)
    const card = await screen.findByRole('tooltip', {}, { timeout: PEEK_OPEN_DELAY_MS + 2000 })
    expect(card).toHaveTextContent('How we cut build times')
    expect(card).toHaveTextContent('Caching and parallelism.')
    expect(link).toHaveAttribute('aria-describedby', card.id)
  })

  it('shows nothing for a link with no preview yet', async () => {
    render(<Page view={{ state: 'pending' }} />)
    rest(screen.getByRole('link', { name: 'the post' }))
    await pastTheDelay()
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('shows nothing for a link the organisation does not allow', async () => {
    render(<Page view={{ state: 'blocked' }} />)
    rest(screen.getByRole('link', { name: 'the post' }))
    await pastTheDelay()
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('shows nothing for a reader who has turned it off', async () => {
    localStorage.setItem(`${BRAND.slug}.link-peek`, 'off')
    render(<Page view={READY} />)
    rest(screen.getByRole('link', { name: 'the post' }))
    await pastTheDelay()
    expect(screen.queryByRole('tooltip')).toBeNull()
  })
})
