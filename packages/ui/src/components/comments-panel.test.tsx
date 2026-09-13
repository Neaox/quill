import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { expectNoAccessibilityViolations } from '../../testing/axe.ts'
import { ThemeVariantsProvider } from '../theme/theme-variants.tsx'
import { CommentsPanel, type DocumentComment } from './comments-panel.tsx'

const COMMENTS: readonly DocumentComment[] = [
  {
    id: 'c1',
    author: 'Sam',
    anchor: 'L18',
    body: 'What is the cache lifetime here?',
    at: '2026-08-14',
    href: '#c1',
  },
  {
    id: 'c2',
    author: 'Ada',
    anchor: 'L42',
    body: 'This paragraph should name the gateway.',
    at: '2026-08-15',
    href: '#c2',
  },
]

describe('CommentsPanel', () => {
  it('is a region whose name carries the count', async () => {
    const { container } = render(<CommentsPanel comments={COMMENTS} />)

    const region = screen.getByRole('region', { name: 'Comments, 2' })
    expect(within(region).getAllByRole('listitem')).toHaveLength(2)
    expect(within(region).getByText('2026-08-14')).toHaveAttribute('datetime', '2026-08-14')
    await expectNoAccessibilityViolations(container)
  })

  it('anchors each comment to the place it is about', () => {
    render(<CommentsPanel comments={COMMENTS} />)

    const first = screen.getByRole('link', { name: /What is the cache lifetime/ })
    expect(first).toHaveAttribute('href', '#c1')
    expect(within(first).getByText(/L18/)).toBeInTheDocument()
  })

  it('takes a caller name and stays correct when empty', () => {
    render(<CommentsPanel label="Notes" comments={[]} className="mt-4" />)

    expect(screen.getByRole('region', { name: 'Notes, 0' })).toBeInTheDocument()
  })

  /*
   * TODO(ADR-028): Press's `sidenotes` variant — comments set in the margin
   * beside the paragraph they discuss — is not built. Until it is, the panel
   * renders instead, which loses the placement but no content. This test is
   * the marker: when sidenotes are built it should assert notes positioned
   * against their anchors, and the note in `CommentsPanelProps` goes with it.
   */
  it('renders the panel for the sidenotes variant, which is not built yet', () => {
    render(
      <ThemeVariantsProvider themeId="press">
        <CommentsPanel comments={COMMENTS} />
      </ThemeVariantsProvider>,
    )

    const region = screen.getByRole('region', { name: 'Comments, 2' })
    expect(region).toHaveAttribute('data-comments', 'sidenotes')
    expect(within(region).getAllByRole('listitem')).toHaveLength(2)
  })

  it('lets a preview ask for a variant the page is not in', () => {
    render(<CommentsPanel comments={COMMENTS} variant="sidenotes" />)

    expect(screen.getByRole('region', { name: 'Comments, 2' })).toHaveAttribute(
      'data-comments',
      'sidenotes',
    )
  })
})
