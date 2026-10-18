import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { expectNoAccessibilityViolations } from '../../testing/axe.ts'
import { LifecycleNotice } from './lifecycle-notice.tsx'

describe('LifecycleNotice', () => {
  it('says the page is deprecated and leads to its replacement', async () => {
    const { container } = render(
      <LifecycleNotice
        replacement={{
          target: {
            to: '/w/$workspaceSlug/d/$documentId',
            params: { workspaceSlug: 'eng', documentId: 'setup-k7m3q9v2rt' },
          },
          title: 'Setting up',
        }}
      />,
    )
    const notice = screen.getByRole('note', { name: 'Deprecated' })
    expect(notice).toHaveTextContent('This page is deprecated. Use Setting up instead.')
    expect(screen.getByRole('link', { name: 'Setting up' })).toHaveAttribute(
      'href',
      '/w/eng/d/setup-k7m3q9v2rt',
    )
    await expectNoAccessibilityViolations(container)
  })

  it('says it is kept for reference when there is no replacement to follow', () => {
    render(<LifecycleNotice />)
    expect(screen.getByRole('note')).toHaveTextContent('kept for reference')
    expect(screen.queryByRole('link')).toBeNull()
  })
})
