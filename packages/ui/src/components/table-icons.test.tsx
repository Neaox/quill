import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  AlignCenterIcon,
  AlignLeftIcon,
  AlignRightIcon,
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  ColumnLeftIcon,
  ColumnRightIcon,
  OptionsIcon,
  RowAboveIcon,
  RowBelowIcon,
  TrashIcon,
} from './table-icons.tsx'

const ICONS = [
  ['AlignLeftIcon', AlignLeftIcon],
  ['AlignCenterIcon', AlignCenterIcon],
  ['AlignRightIcon', AlignRightIcon],
  ['RowAboveIcon', RowAboveIcon],
  ['RowBelowIcon', RowBelowIcon],
  ['ColumnLeftIcon', ColumnLeftIcon],
  ['ColumnRightIcon', ColumnRightIcon],
  ['ArrowUpIcon', ArrowUpIcon],
  ['ArrowDownIcon', ArrowDownIcon],
  ['ArrowLeftIcon', ArrowLeftIcon],
  ['ArrowRightIcon', ArrowRightIcon],
  ['OptionsIcon', OptionsIcon],
  ['TrashIcon', TrashIcon],
] as const

describe('table icons', () => {
  it.each(ICONS)('%s is hidden from assistive technology and out of the tab order', (_, Icon) => {
    const { container } = render(<Icon className="text-accent" />)

    const svg = container.querySelector('svg')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).toHaveAttribute('focusable', 'false')
    expect(svg).toHaveClass('size-4', 'text-accent')
  })

  it('draws a different glyph for each', () => {
    const shapes = new Set<string>()
    for (const [, Icon] of ICONS) {
      const { container, unmount } = render(<Icon />)
      shapes.add(container.querySelector('svg')?.innerHTML ?? '')
      unmount()
    }

    expect(shapes.size).toBe(ICONS.length)
  })
})
