import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { expectNoAccessibilityViolations } from '../../testing/axe.ts'
import { Avatar, initialsOf } from './avatar.tsx'
import { DocumentByline, type DocumentBylineProps } from './document-byline.tsx'

const NOW = new Date(Date.UTC(2026, 9, 17, 9))

const FULL: DocumentBylineProps = {
  owners: [
    { label: 'Alex Chen', person: true },
    { label: 'platform@example.com', person: false },
  ],
  lifecycle: { state: 'in-review' },
  type: 'Runbook',
  updatedAt: new Date(Date.UTC(2026, 9, 14)),
  lastReviewed: new Date(Date.UTC(2026, 6, 12)),
  reviewDue: { at: new Date(Date.UTC(2027, 0, 12)), overdue: false },
  tags: ['ops', 'On call'],
  now: NOW,
  tagTarget: (tag) => ({
    to: '/w/$workspaceSlug/search',
    params: { workspaceSlug: 'eng' },
    search: { q: `tag:${tag}` },
  }),
}

describe('Avatar', () => {
  it('takes the initials of a name, and of an address before its @', () => {
    expect(initialsOf('Alex Chen')).toBe('AC')
    expect(initialsOf('ada')).toBe('A')
    expect(initialsOf('Mary Ann de la Cruz')).toBe('MC')
    expect(initialsOf('sre@example.com')).toBe('S')
    expect(initialsOf('  ')).toBe('?')
  })

  it('is decorative beside the name it stands for', () => {
    const { container } = render(<Avatar name="Alex Chen" />)
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true')
    expect(container).toHaveTextContent('AC')
  })
})

describe('DocumentByline', () => {
  it('is a description list of the facts a reader looks for, each named', async () => {
    const { container } = render(<DocumentByline {...FULL} />)
    const list = screen.getByRole('group', { name: 'Document properties' })
    expect(list.tagName).toBe('DIV')
    expect(container.querySelector('dl')).not.toBeNull()

    const terms = [...container.querySelectorAll('dt')].map((term) => term.textContent)
    expect(terms).toEqual(['Owners', 'Lifecycle', 'Type', 'Updated', 'Review', 'Tags'])
    await expectNoAccessibilityViolations(container)
  })

  it('shows owners as people, never their addresses when they are people', () => {
    render(<DocumentByline {...FULL} />)
    const owners = screen.getByRole('list', { name: 'Owners' })
    const items = within(owners).getAllByRole('listitem')
    expect(items.map((item) => item.textContent)).toEqual(['ACAlex Chen', 'Pplatform@example.com'])
    expect(items[0]).toHaveAttribute('data-person', 'true')
    expect(items[1]).toHaveAttribute('data-person', 'false')
  })

  it('says the lifecycle in words, with the tone on an attribute', () => {
    render(<DocumentByline {...FULL} />)
    const lifecycle = screen.getByText('In review')
    expect(lifecycle.closest('[data-lifecycle]')).toHaveAttribute('data-lifecycle', 'in-review')
  })

  it('says who verified a page and when, as people and relative time', async () => {
    const { container } = render(
      <DocumentByline
        lifecycle={{ state: 'verified', by: 'Ada Lovelace', at: new Date(Date.UTC(2026, 9, 2)) }}
        now={NOW}
      />,
    )
    expect(container).toHaveTextContent('Verifiedby Ada Lovelace2 weeks ago')
    expect(container.querySelector('time')).toHaveAttribute('datetime', '2026-10-02')
    await expectNoAccessibilityViolations(container)
  })

  it('says a lapsed verification is lapsed, in words, and never that it stands', () => {
    const { container } = render(
      <DocumentByline
        lifecycle={{ state: 'verified', by: 'Ada Lovelace', lapsed: true }}
        reviewDue={{ at: new Date(Date.UTC(2026, 8, 1)), overdue: true }}
        now={NOW}
      />,
    )
    expect(screen.getByText('Verification lapsed').closest('[data-lifecycle]')).toHaveAttribute(
      'data-lifecycle',
      'lapsed',
    )
    expect(container).not.toHaveTextContent('Ada Lovelace')
    expect(container).toHaveTextContent('Review overdue')
  })

  it('says a review falling due within the fortnight is due', () => {
    const { container } = render(
      <DocumentByline
        reviewDue={{ at: new Date(Date.UTC(2026, 9, 24)), overdue: false, soon: true }}
        now={NOW}
      />,
    )
    expect(container.querySelector('.byline-due')).toHaveTextContent('Review due next week')
  })

  it('says when, relatively, with the exact date in the element and its tooltip', () => {
    const { container } = render(<DocumentByline {...FULL} />)
    const times = [...container.querySelectorAll('time')]
    expect(times.map((time) => [time.textContent, time.dateTime, time.title])).toEqual([
      ['3 days ago', '2026-10-14', '14 Oct 2026'],
      ['3 months ago', '2026-07-12', '12 Jul 2026'],
      ['in 2 months', '2027-01-12', '12 Jan 2027'],
    ])
    expect(container).toHaveTextContent('Updated 3 days ago')
    expect(container).toHaveTextContent('Reviewed 3 months ago')
    expect(container).toHaveTextContent('next due in 2 months')
  })

  it('says an overdue review in words, not only in colour', () => {
    const { container } = render(
      <DocumentByline
        reviewDue={{ at: new Date(Date.UTC(2026, 8, 1)), overdue: true }}
        now={NOW}
      />,
    )
    expect(container).toHaveTextContent('Review overdue, due last month')
    expect(container.querySelector('[data-overdue]')).not.toBeNull()
  })

  it('says how often a document is reviewed when no date can be counted yet', () => {
    const { container } = render(<DocumentByline reviewEvery="6 months" />)
    expect(container.querySelector('dt')).toHaveTextContent('Review')
    expect(container).toHaveTextContent('Review every 6 months')
  })

  it('reads the review as one sentence, whichever parts of it are known', () => {
    const at = new Date(Date.UTC(2027, 0, 12))
    const reviewed = new Date(Date.UTC(2026, 6, 12))
    const text = (props: Partial<DocumentBylineProps>) =>
      render(<DocumentByline now={NOW} {...props} />).container.textContent
    expect(text({ reviewDue: { at, overdue: false } })).toBe('ReviewReview due in 2 months')
    expect(text({ lastReviewed: reviewed, reviewEvery: '6 months' })).toBe(
      'ReviewReviewed 3 months agoevery 6 months',
    )
    expect(text({ lastReviewed: reviewed })).toBe('ReviewReviewed 3 months ago')
  })

  it('says absolute dates where there is no now to be relative to', () => {
    const { container } = render(<DocumentByline {...FULL} now={undefined} />)
    expect(container).toHaveTextContent('Updated 14 Oct 2026')
    expect(container).toHaveTextContent('Reviewed 12 Jul 2026')
    expect(container).toHaveTextContent('next due 12 Jan 2027')
  })

  it('links each tag to the search for it, and lets a label colour one', () => {
    render(<DocumentByline {...FULL} />)
    const tags = screen.getByRole('list', { name: 'Tags' })
    const ops = within(tags).getByRole('link', { name: 'ops' })
    expect(ops).toHaveAttribute('href', '/w/eng/search?q=tag%3Aops')
    // A name a label could have carries it, so the theme's label rule colours
    // the dot; one no label could have does not.
    expect(ops).toHaveAttribute('data-label', 'ops')
    expect(within(tags).getByRole('link', { name: 'On call' })).not.toHaveAttribute('data-label')
  })

  it('shows tags as words where there is nowhere to search', () => {
    render(<DocumentByline tags={['ops']} />)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('ops')).toBeInTheDocument()
  })

  it('takes no room at all when a document says nothing about itself', () => {
    const { container } = render(<DocumentByline owners={[]} tags={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('lets a caller wrap each value, and add entries after the facts', () => {
    render(
      <DocumentByline
        lifecycle={{ state: 'deprecated' }}
        renderValue={(field, value) => (
          <button type="button" aria-label={`Change ${field}`}>
            {value}
          </button>
        )}
      >
        <button type="button">Add property</button>
      </DocumentByline>,
    )
    expect(screen.getByRole('button', { name: 'Change lifecycle' })).toHaveTextContent('Deprecated')
    expect(screen.getByRole('button', { name: 'Add property' })).toBeInTheDocument()
  })

  it('shows its own entries even with no facts', () => {
    render(
      <DocumentByline>
        <button type="button">Add property</button>
      </DocumentByline>,
    )
    expect(screen.getByRole('button', { name: 'Add property' })).toBeInTheDocument()
    expect(document.querySelector('dl')).toBeNull()
  })
})
