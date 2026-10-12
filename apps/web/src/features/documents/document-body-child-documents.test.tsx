import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { DocumentBody } from './document-body.tsx'

const slot = (depth: string, fallback = '::children{depth="2"}'): string =>
  `<section class="live-block" data-live-block="children" aria-label="Live block: children" data-depth="${depth}"><p>${fallback}</p></section>`

const article = (...blocks: string[]): string => `<article>${blocks.join('')}</article>`

describe('the child-documents slots of a body', () => {
  it('keep their readable fallback when nothing is there to fill them', () => {
    render(<DocumentBody html={article(slot('2'))} label="Doc" />)
    expect(screen.getByText('::children{depth="2"}')).toBeVisible()
  })

  it('are given to the caller to draw, each with how deep it asks to go', () => {
    render(
      <DocumentBody
        html={article(slot('2'), '<p>Between.</p>', slot('4'))}
        label="Doc"
        renderChildDocuments={(depth) => <p>{`list to depth ${String(depth)}`}</p>}
      />,
    )
    const [first, second] = screen.getAllByRole('region', { name: 'Child documents' })
    expect(within(first as HTMLElement).getByText('list to depth 2')).toBeVisible()
    expect(within(second as HTMLElement).getByText('list to depth 4')).toBeVisible()
  })

  it('give up the fallback to what replaces it, so the directive’s source is not shown twice', () => {
    render(
      <DocumentBody
        html={article(slot('2'))}
        label="Doc"
        renderChildDocuments={() => <p>The list.</p>}
      />,
    )
    expect(screen.queryByText('::children{depth="2"}')).not.toBeInTheDocument()
    expect(screen.getByText('The list.')).toBeVisible()
  })

  it('stay in the document, among the blocks around them', () => {
    const { container } = render(
      <DocumentBody
        html={article('<p>Before.</p>', slot('1'), '<p>After.</p>')}
        label="Doc"
        renderChildDocuments={() => <p>The list.</p>}
      />,
    )
    const children = [...(container.querySelector('article')?.children ?? [])]
    expect(children.map((child) => child.tagName)).toEqual(['P', 'SECTION', 'P'])
  })

  it.each(['0', 'deep', ''])('fall back to the direct children for a depth of %j', (depth) => {
    render(
      <DocumentBody
        html={article(slot(depth))}
        label="Doc"
        renderChildDocuments={(asked) => <p>{`depth ${String(asked)}`}</p>}
      />,
    )
    expect(screen.getByText('depth 1')).toBeVisible()
  })

  it('are replaced with the body when the body changes', () => {
    const { rerender } = render(
      <DocumentBody
        html={article(slot('1'))}
        label="Doc"
        renderChildDocuments={(depth) => <p>{`first ${String(depth)}`}</p>}
      />,
    )
    expect(screen.getByText('first 1')).toBeVisible()
    rerender(
      <DocumentBody
        html={article(slot('3'))}
        label="Doc"
        renderChildDocuments={(depth) => <p>{`second ${String(depth)}`}</p>}
      />,
    )
    expect(screen.queryByText('first 1')).not.toBeInTheDocument()
    expect(screen.getByText('second 3')).toBeVisible()
  })

  it('are drawn inside a block that is itself nested in a layout wrapper', () => {
    render(
      <DocumentBody
        html={article(`<div class="layout-wide">${slot('1')}</div>`)}
        label="Doc"
        renderChildDocuments={() => <p>The list.</p>}
      />,
    )
    expect(
      within(screen.getByRole('region', { name: 'Child documents' })).getByText('The list.'),
    ).toBeVisible()
  })

  it('answer to the pointer, because what is drawn into them is still the application’s', async () => {
    const { default: userEvent } = await import('@testing-library/user-event')
    let clicks = 0
    render(
      <DocumentBody
        html={article(slot('1'))}
        label="Doc"
        renderChildDocuments={() => (
          <button
            type="button"
            onClick={() => {
              clicks += 1
            }}
          >
            Open
          </button>
        )}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(clicks).toBe(1)
  })
})
