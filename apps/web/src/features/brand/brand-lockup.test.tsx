import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { BRAND } from '@quill/brand'
import { expectNoAccessibilityViolations } from '@quill/ui/testing/axe'

import { BrandLockup } from './brand-lockup.tsx'

describe('BrandLockup', () => {
  it('says the product name once, in words', async () => {
    const { container } = render(<BrandLockup />)

    expect(screen.getByText(BRAND.name)).toBeInTheDocument()
    expect(container).toHaveTextContent(new RegExp(`^${BRAND.name}$`))
    await expectNoAccessibilityViolations(container)
  })

  it('keeps the mark out of the accessibility tree, because the name beside it is the label', () => {
    const { container } = render(<BrandLockup />)

    const mark = container.querySelector('svg')
    expect(mark).toHaveAttribute('aria-hidden', 'true')
    expect(mark).toHaveAttribute('focusable', 'false')
  })

  it('draws the mark from the theme tokens, so every identity and scheme recolours it', () => {
    const { container } = render(<BrandLockup />)

    const fills = [...container.querySelectorAll('svg *')].map((shape) =>
      shape.getAttribute('class'),
    )
    expect(fills).toEqual(
      expect.arrayContaining([
        expect.stringContaining('fill-foreground'),
        expect.stringContaining('fill-background'),
        expect.stringContaining('fill-accent'),
      ]),
    )
    for (const shape of container.querySelectorAll('svg *')) {
      expect(shape).not.toHaveAttribute('fill')
      expect(shape).not.toHaveAttribute('style')
    }
  })
})
