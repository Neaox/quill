import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Spinner } from './spinner.tsx'

describe('Spinner', () => {
  it('is decorative: the component that shows it says what is busy', () => {
    const { container } = render(<Spinner />)

    const svg = container.querySelector('svg')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).toHaveAttribute('focusable', 'false')
  })

  it('accepts caller classes', () => {
    const { container } = render(<Spinner className="text-accent" />)

    expect(container.querySelector('svg')).toHaveClass('animate-spin', 'text-accent')
  })
})
