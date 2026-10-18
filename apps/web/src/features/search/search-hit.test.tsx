import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { expectNoAccessibilityViolations } from '@quill/ui/testing/axe'

import { searchHitFixture } from '../../lib/api/search-fixtures.ts'
import { SearchHitDetail, contributorsPhrase } from './search-hit.tsx'

const NOW = new Date('2026-10-17T12:00:00.000Z')

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

const UPDATED = '2026-10-17T10:00:00.000Z'

describe('contributorsPhrase', () => {
  it('says nothing when nobody is to be credited', () => {
    expect(contributorsPhrase([], 0)).toBeUndefined()
  })

  it('lists the names it was given', () => {
    expect(contributorsPhrase([{ name: 'Ada Lovelace' }, { name: 'Sam Taylor' }], 2)).toBe(
      'by Ada Lovelace, Sam Taylor',
    )
  })

  it('counts the people it left out', () => {
    expect(contributorsPhrase([{ name: 'Ada Lovelace' }, { name: 'Sam Taylor' }], 4)).toBe(
      'by Ada Lovelace, Sam Taylor +2',
    )
  })
})

describe('SearchHitDetail', () => {
  it('shows the matched words, where the document lives, and when it last changed', () => {
    render(<SearchHitDetail hit={searchHitFixture('Regional failover', { updatedAt: UPDATED })} />)

    expect(screen.getByText('failover').tagName).toBe('MARK')
    expect(screen.getByText('Engineering')).toBeInTheDocument()
    const time = screen.getByText('2 hours ago')
    expect(time.tagName).toBe('TIME')
    expect(time).toHaveAttribute('datetime', UPDATED)
    expect(screen.getByText(/^Updated/)).toBeInTheDocument()
  })

  it('shows no status for a published document, which is the ordinary case', () => {
    render(<SearchHitDetail hit={searchHitFixture('Regional failover')} />)

    expect(screen.queryByText('published')).not.toBeInTheDocument()
  })

  it('names any other status in words', () => {
    render(<SearchHitDetail hit={searchHitFixture('Regional failover', { status: 'draft' })} />)

    expect(screen.getByText('draft')).toBeInTheDocument()
  })

  it('credits the people who wrote it, and how many more there were', () => {
    render(
      <SearchHitDetail
        hit={searchHitFixture('Regional failover', {
          contributors: [{ name: 'Ada Lovelace' }, { name: 'Sam Taylor' }],
          contributorCount: 4,
        })}
      />,
    )

    expect(screen.getByText('by Ada Lovelace, Sam Taylor +2')).toBeInTheDocument()
  })

  it('leaves out the credit altogether when there is nobody to credit', () => {
    render(<SearchHitDetail hit={searchHitFixture('Regional failover')} />)

    expect(screen.queryByText(/^by /)).not.toBeInTheDocument()
  })

  it('shows up to three tags in the comfortable density, under a name for screen readers', () => {
    render(
      <SearchHitDetail
        hit={searchHitFixture('Regional failover', {
          tags: ['incident', 'postmortem', 'dr', 'ignored'],
        })}
      />,
    )

    expect(screen.getByText('Tags:')).toBeInTheDocument()
    for (const tag of ['incident', 'postmortem', 'dr']) {
      expect(screen.getByText(tag)).toBeInTheDocument()
    }
    expect(screen.queryByText('ignored')).not.toBeInTheDocument()
  })

  it('shows no tags row for a document with none', () => {
    render(<SearchHitDetail hit={searchHitFixture('Regional failover')} />)

    expect(screen.queryByText('Tags:')).not.toBeInTheDocument()
  })

  it('keeps the compact density to one line: no tags', () => {
    render(
      <SearchHitDetail
        density="compact"
        hit={searchHitFixture('Regional failover', { tags: ['incident'], status: 'draft' })}
      />,
    )

    expect(screen.queryByText('incident')).not.toBeInTheDocument()
    expect(screen.getByText('draft')).toBeInTheDocument()
    expect(screen.getByText(/^Updated/)).toBeInTheDocument()
  })

  it.each(['compact', 'comfortable'] as const)(
    'has no accessibility violations (%s)',
    async (density) => {
      const { container } = render(
        <SearchHitDetail
          density={density}
          hit={searchHitFixture('Regional failover', {
            status: 'draft',
            tags: ['incident'],
            contributors: [{ name: 'Ada Lovelace' }],
            contributorCount: 3,
          })}
        />,
      )

      await expectNoAccessibilityViolations(container)
    },
  )
})
