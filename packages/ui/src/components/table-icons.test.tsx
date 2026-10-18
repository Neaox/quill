import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  AlignCenterIcon,
  AlignLeftIcon,
  AlignRightIcon,
  CaptionIcon,
  ColumnLeftIcon,
  ColumnRightIcon,
  DeleteColumnIcon,
  DeleteRowIcon,
  FooterRowIcon,
  HeaderColumnIcon,
  HeaderRowIcon,
  RowAboveIcon,
  RowBelowIcon,
  TableOptionsIcon,
} from './table-icons.tsx'

const ICONS = [
  ['HeaderRowIcon', HeaderRowIcon],
  ['HeaderColumnIcon', HeaderColumnIcon],
  ['FooterRowIcon', FooterRowIcon],
  ['CaptionIcon', CaptionIcon],
  ['AlignLeftIcon', AlignLeftIcon],
  ['AlignCenterIcon', AlignCenterIcon],
  ['AlignRightIcon', AlignRightIcon],
  ['RowAboveIcon', RowAboveIcon],
  ['RowBelowIcon', RowBelowIcon],
  ['ColumnLeftIcon', ColumnLeftIcon],
  ['ColumnRightIcon', ColumnRightIcon],
  ['DeleteRowIcon', DeleteRowIcon],
  ['DeleteColumnIcon', DeleteColumnIcon],
  ['TableOptionsIcon', TableOptionsIcon],
] as const

describe('the table icons', () => {
  it.each(ICONS)('%s is decorative and sized with the text', (_name, Icon) => {
    const { container } = render(<Icon className="extra" />)
    const svg = container.querySelector('svg')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).toHaveAttribute('focusable', 'false')
    expect(svg?.getAttribute('class')).toContain('extra')
  })
})
