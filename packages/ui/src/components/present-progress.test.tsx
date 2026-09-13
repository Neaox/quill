import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { expectNoAccessibilityViolations } from '../../testing/axe.ts'
import { PresentProgress } from './present-progress.tsx'

describe('PresentProgress', () => {
  it('is a determinate progress element carrying the position in words', async () => {
    const { container } = render(<PresentProgress value={2} max={7} />)

    const bar = screen.getByRole('progressbar', { name: 'Presentation progress' })
    expect(bar).toHaveAttribute('value', '2')
    expect(bar).toHaveAttribute('max', '7')
    expect(bar).toHaveAttribute('aria-valuetext', 'Section 2 of 7')
    await expectNoAccessibilityViolations(container)
  })

  it('takes a caller label and caller classes', () => {
    render(<PresentProgress value={1} max={1} label="Where we are" className="opacity-50" />)

    expect(screen.getByRole('progressbar', { name: 'Where we are' })).toHaveClass('opacity-50')
  })
})
