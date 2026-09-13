import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { expectNoAccessibilityViolations } from '../../testing/axe.ts'
import { ProgressBar } from './progress-bar.tsx'

describe('ProgressBar', () => {
  it('is the accessible progress element itself, indeterminate and labelled', async () => {
    const { container } = render(<ProgressBar label="Loading page" />)

    const bar = screen.getByRole('progressbar', { name: 'Loading page' })
    expect(bar).toHaveAttribute('aria-busy', 'true')
    expect(bar).not.toHaveAttribute('aria-valuenow')
    await expectNoAccessibilityViolations(container)
  })

  it('pins to the top of the viewport for page-level work', () => {
    render(<ProgressBar label="Loading page" placement="top" />)

    expect(screen.getByRole('progressbar')).toHaveClass('fixed', 'top-0', 'inset-x-0')
  })

  it('sits in flow by default and accepts caller classes', () => {
    render(<ProgressBar label="Loading results" className="mt-2" />)

    const bar = screen.getByRole('progressbar')
    expect(bar).not.toHaveClass('fixed')
    expect(bar).toHaveClass('w-full', 'mt-2')
  })
})
