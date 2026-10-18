import { render, renderHook, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { FieldFilterKey } from '@quill/search/query'
import { expectNoAccessibilityViolations } from '@quill/ui/testing/axe'

import type { SearchFacets, SearchResults } from '../../lib/api/index.ts'
import { facetValueFixture as value, searchResultsFixture } from '../../lib/api/search-fixtures.ts'
import { RefineFacets, useRetainedFacets } from './refine-facets.tsx'

const FACETS: SearchFacets = {
  tag: [value('api', 12), value('area/billing', 1)],
  status: [value('draft', 3, 'Draft')],
  collection: [value('runbooks', 2, 'Runbooks')],
}

function setup(facets: SearchFacets | undefined, query = 'failover') {
  const onRefine = vi.fn<(key: FieldFilterKey, value: string) => void>()
  const view = render(<RefineFacets facets={facets} query={query} onRefine={onRefine} />)
  return { onRefine, ...view }
}

describe('RefineFacets', () => {
  it('is a section headed Refine, with one labelled group for each facet', () => {
    setup(FACETS)

    const section = screen.getByRole('region', { name: 'Refine' })
    expect(within(section).getByRole('heading', { level: 2, name: 'Refine' })).toBeInTheDocument()
    expect(within(section).getByRole('list', { name: 'Tag' })).toBeInTheDocument()
    expect(within(section).getByRole('list', { name: 'Status' })).toBeInTheDocument()
    expect(within(section).getByRole('list', { name: 'Collection' })).toBeInTheDocument()
  })

  it('names each button for its value and its count, in the singular for one', () => {
    setup(FACETS)

    expect(screen.getByRole('button', { name: 'api, 12 results' })).toHaveTextContent('api12')
    expect(screen.getByRole('button', { name: 'area/billing, 1 result' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Draft, 3 results' })).toBeInTheDocument()
  })

  it('formats a large count for reading', () => {
    setup({ tag: [value('api', 12345)] })

    expect(
      screen.getByRole('button', { name: `api, ${(12345).toLocaleString()} results` }),
    ).toBeInTheDocument()
  })

  it('refines with the filter key and the value as the server wrote it, not its label', async () => {
    const { onRefine } = setup(FACETS)

    await userEvent.click(screen.getByRole('button', { name: 'Draft, 3 results' }))
    await userEvent.click(screen.getByRole('button', { name: 'Runbooks, 2 results' }))
    await userEvent.click(screen.getByRole('button', { name: 'api, 12 results' }))

    expect(onRefine.mock.calls).toEqual([
      ['status', 'draft'],
      ['collection', 'runbooks'],
      ['tag', 'api'],
    ])
  })

  it('is operable from the keyboard', async () => {
    const { onRefine } = setup(FACETS)

    await userEvent.tab()
    await userEvent.keyboard('{Enter}')

    expect(onRefine).toHaveBeenCalledWith('tag', 'api')
  })

  it('leaves out what the query already filters on, and a group with nothing left', () => {
    setup(FACETS, 'tag:API tag:area/billing status:draft')

    expect(screen.queryByRole('button', { name: /^api/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Tag' })).not.toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Status' })).not.toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Collection' })).toBeInTheDocument()
  })

  it('renders nothing at all when there is nothing to refine', () => {
    const none = setup(undefined)
    expect(none.container).toBeEmptyDOMElement()
    none.unmount()

    const applied = setup({ tag: [value('api', 1)] }, 'tag:api')
    expect(applied.container).toBeEmptyDOMElement()
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
  })

  it('truncates a long value instead of widening the row, and says all of it', () => {
    const long = 'a-very-long-tag-name-that-would-push-a-narrow-screen-sideways'
    setup({ tag: [value(long, 2)] })

    const button = screen.getByRole('button', { name: `${long}, 2 results` })
    expect(within(button).getByText(long)).toHaveClass('truncate')
  })

  it('has no accessibility violations', async () => {
    const { container } = setup(FACETS)

    await expectNoAccessibilityViolations(container)
  })
})

function renderRetained(answer: SearchResults | undefined) {
  return renderHook(
    ({ answer: current }: { answer: SearchResults | undefined }) => useRetainedFacets(current),
    { initialProps: { answer } },
  )
}

describe('useRetainedFacets', () => {
  const first = searchResultsFixture('a', [], { tag: [value('api', 1)] })
  const second = searchResultsFixture('b', [], { status: [value('draft', 1)] })
  const bare = searchResultsFixture('c', [])

  it('shows the facets of the answer it has', () => {
    const { result } = renderRetained(first)

    expect(result.current).toEqual(first.facets)
  })

  it('keeps the previous facets while the next answer is on its way', () => {
    const { result, rerender } = renderRetained(first)

    rerender({ answer: undefined })

    expect(result.current).toEqual(first.facets)
  })

  it('replaces them when the next answer lands, and drops them if it has none', () => {
    const { result, rerender } = renderRetained(first)

    rerender({ answer: second })
    expect(result.current).toEqual(second.facets)

    rerender({ answer: bare })
    expect(result.current).toBeUndefined()
  })

  it('has nothing before the first answer', () => {
    const { result } = renderRetained(undefined)

    expect(result.current).toBeUndefined()
  })
})
