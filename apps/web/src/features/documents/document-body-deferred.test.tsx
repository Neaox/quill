import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/*
 * The body's deferred enhancements are their own chunk (quill-plan.md section
 * 31; `deferred-enhancements.ts`). Every other test runs with that chunk
 * already here (`vitest.setup.ts`); these load a fresh `DocumentBody` whose
 * chunk has not arrived, and decide when it does.
 */

const BODY =
  '<article><h1 id="t">Shipping</h1>' +
  '<div class="table-block"><div class="table-scroll" tabindex="0" role="group" aria-label="Table"><table>' +
  '<thead><tr><th scope="col">Region</th></tr></thead><tbody><tr><td>eu</td></tr></tbody>' +
  '</table></div></div>' +
  '<p>Shipped <picture class="emoji" data-frames="12" data-loop-ms="1200">' +
  '<source srcset="/api/emoji/party.bbbbbbbbbbbbbbbb.gif" media="(prefers-reduced-motion: reduce)">' +
  '<img class="emoji" src="/api/emoji/party.aaaaaaaaaaaaaaaa.gif" alt=":party:" title=":party:" width="20" height="20">' +
  '</picture> today.</p></article>'

async function freshBody() {
  vi.resetModules()
  const { promise: arrived, resolve: arrive } = Promise.withResolvers<void>()
  vi.doMock('./deferred-enhancements.ts', async () => {
    await arrived
    return vi.importActual('./deferred-enhancements.ts')
  })
  const { DocumentBody } = await import('./document-body.tsx')
  return { DocumentBody, arrive }
}

afterEach(() => {
  vi.doUnmock('./deferred-enhancements.ts')
})

describe('a body drawn before its deferred enhancements arrive', () => {
  it('has its layout at once, and the rest when the chunk arrives', async () => {
    const { DocumentBody, arrive } = await freshBody()
    render(<DocumentBody html={BODY} label="Shipping" />)
    const article = screen.getByRole('article', { name: 'Shipping' })

    // What moves the layout is there with the body: the table's reading tools.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Expand table' })).toBeInTheDocument()
    })
    expect(article.querySelector('picture')).not.toHaveAttribute('data-state')

    arrive()
    await waitFor(() => {
      expect(article.querySelector('picture')).toHaveAttribute('data-state')
    })
  })

  it('leaves a body that has gone alone when the chunk arrives late', async () => {
    const { DocumentBody, arrive } = await freshBody()
    const { unmount } = render(<DocumentBody html={BODY} label="Shipping" />)
    const picture = screen.getByRole('article', { name: 'Shipping' }).querySelector('picture')
    unmount()

    arrive()
    const { DocumentBody: Later } = await import('./document-body.tsx')
    render(<Later html={BODY} label="Again" />)
    await waitFor(() => {
      expect(
        screen.getByRole('article', { name: 'Again' }).querySelector('picture'),
      ).toHaveAttribute('data-state')
    })
    expect(picture).not.toHaveAttribute('data-state')
  })
})
