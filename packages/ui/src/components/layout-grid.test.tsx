import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Block, LayoutGrid } from './layout-grid.tsx'

describe('LayoutGrid', () => {
  it('renders the named-line grid', () => {
    render(
      <LayoutGrid>
        <p>Body.</p>
      </LayoutGrid>,
    )

    expect(screen.getByText('Body.').parentElement).toHaveClass('layout-grid')
  })

  it('appends caller classes', () => {
    const { container } = render(
      <LayoutGrid className="py-16">
        <p>Body.</p>
      </LayoutGrid>,
    )

    expect(container.firstElementChild).toHaveClass('layout-grid', 'py-16')
  })
})

describe('Block', () => {
  it('defaults to the reading measure', () => {
    render(<Block>Body.</Block>)

    expect(screen.getByText('Body.')).toHaveClass('layout-content')
  })

  it.each([
    ['content', 'layout-content'],
    ['wide', 'layout-wide'],
    ['full', 'layout-full'],
  ] as const)('maps the %s width to the %s line pair', (width, expected) => {
    render(<Block width={width}>Body.</Block>)

    expect(screen.getByText('Body.')).toHaveClass(expected)
  })

  it('appends caller classes', () => {
    render(
      <Block width="wide" className="table-scroll">
        Body.
      </Block>,
    )

    expect(screen.getByText('Body.')).toHaveClass('layout-wide', 'table-scroll')
  })
})
