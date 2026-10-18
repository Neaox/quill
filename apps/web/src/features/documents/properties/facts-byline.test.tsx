import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PlainLink } from '@quill/ui'
import { expectNoAccessibilityViolations } from '@quill/ui/testing/axe'

import { FactsByline, PublicFactsByline } from './facts-byline.tsx'

const NOW = new Date(Date.UTC(2026, 9, 17, 9))

afterEach(() => {
  vi.useRealTimers()
})

describe('the byline a member reads', () => {
  it('states the published facts, with a review due and tags that find their kind', async () => {
    // "Updated" is a live relative time, which reads the wall clock rather than `now`.
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
    const { container } = render(
      <FactsByline
        workspaceSlug="engineering"
        facts={{
          status: 'draft',
          lifecycle: {
            state: 'verified',
            verifiedBy: { label: 'Grace Hopper', person: true },
            verifiedAt: '2026-10-02',
          },
          owners: [
            { label: 'Ada Lovelace', person: true },
            { label: 'platform', person: false },
          ],
          tags: ['ops', 'On call'],
          reviewInterval: '6m',
          lastReviewed: '2026-07-12',
        }}
        review={{ dueAt: '2027-01-08T00:00:00.000Z', overdue: false }}
        updatedAt="2026-10-14T03:00:00.000Z"
        now={NOW}
        linkComponent={PlainLink}
      />,
    )
    expect(container).toHaveTextContent('Ada Lovelace')
    // A status from before the lifecycle is never shown (ADR-005 amendment).
    expect(container).not.toHaveTextContent('Draft')
    expect(container).toHaveTextContent('Verifiedby Grace Hopper2 weeks ago')
    expect(container).toHaveTextContent('Updated 3 days ago')
    expect(container).toHaveTextContent('Reviewed 3 months ago')
    expect(container).toHaveTextContent('next due in 2 months')
    expect(screen.getByRole('link', { name: 'On call' })).toHaveAttribute(
      'href',
      '/w/engineering/search?q=tag%3A%22On+call%22',
    )
    await expectNoAccessibilityViolations(container)
  })

  it('says a verification whose review is overdue has lapsed, without rewriting anything', () => {
    const { container } = render(
      <FactsByline
        workspaceSlug="engineering"
        facts={{
          lifecycle: { state: 'verified', verifiedBy: { label: 'Grace Hopper', person: true } },
          owners: [],
          tags: [],
        }}
        review={{ dueAt: '2026-10-01T00:00:00.000Z', overdue: true }}
        updatedAt={undefined}
        now={NOW}
        linkComponent={PlainLink}
      />,
    )
    expect(container).toHaveTextContent('Verification lapsed')
    expect(container).not.toHaveTextContent('Grace Hopper')
  })

  it('puts a deprecated page’s notice under it, leading to the replacement', async () => {
    const { container } = render(
      <FactsByline
        workspaceSlug="engineering"
        facts={{
          lifecycle: {
            state: 'deprecated',
            replacement: { href: '/w/engineering/d/setup-k7m3q9v2rt', title: 'Setting up' },
          },
          owners: [],
          tags: [],
        }}
        review={null}
        updatedAt={undefined}
        now={NOW}
        linkComponent={PlainLink}
      />,
    )
    expect(screen.getByRole('note', { name: 'Deprecated' })).toHaveTextContent(
      'This page is deprecated. Use Setting up instead.',
    )
    expect(screen.getByRole('link', { name: 'Setting up' })).toHaveAttribute(
      'href',
      '/w/engineering/d/setup-k7m3q9v2rt',
    )
    await expectNoAccessibilityViolations(container)
  })

  it('says nothing while there is nothing to say', () => {
    const { container } = render(
      <FactsByline
        workspaceSlug="engineering"
        facts={undefined}
        review={null}
        updatedAt={undefined}
        linkComponent={PlainLink}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})

describe('the byline an outsider reads', () => {
  it('states the public facts in absolute dates, with tags as words', () => {
    const { container } = render(
      <PublicFactsByline
        facts={{
          status: 'archived',
          lifecycle: { state: 'verified', verifiedAt: '2026-10-02' },
          tags: ['ops'],
          lastReviewed: '2026-01-02',
        }}
      />,
    )
    expect(container).not.toHaveTextContent('Archived')
    expect(container).toHaveTextContent('Verified2 Oct 2026')
    expect(container).toHaveTextContent('Reviewed 2 Jan 2026')
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('takes no room for a document that states nothing public', () => {
    const { container } = render(<PublicFactsByline facts={undefined} />)
    expect(container).toBeEmptyDOMElement()
  })
})
