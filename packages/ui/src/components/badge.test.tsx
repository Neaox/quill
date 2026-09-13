import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { expectNoAccessibilityViolations } from '../../testing/axe.ts'
import { Badge } from './badge.tsx'

describe('Badge', () => {
  it('renders its text, which carries the meaning on its own', async () => {
    const { container } = render(<Badge>Draft</Badge>)

    expect(screen.getByText('Draft')).toBeInTheDocument()
    await expectNoAccessibilityViolations(container)
  })

  it('gives every tone a different class list, defaulting to neutral', () => {
    const { unmount } = render(<Badge>Draft</Badge>)
    const defaultClasses = screen.getByText('Draft').className
    unmount()

    const classes = new Map<string, string>()
    for (const tone of ['neutral', 'accent', 'success', 'warning', 'danger'] as const) {
      const rendered = render(<Badge tone={tone}>Draft</Badge>)
      classes.set(tone, screen.getByText('Draft').className)
      rendered.unmount()
    }

    expect(new Set(classes.values()).size).toBe(5)
    expect(defaultClasses).toBe(classes.get('neutral'))
  })

  it('appends caller classes', () => {
    render(<Badge className="uppercase">Draft</Badge>)

    expect(screen.getByText('Draft')).toHaveClass('uppercase')
  })
})
