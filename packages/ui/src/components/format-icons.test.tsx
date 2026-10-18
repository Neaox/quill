import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  ArrowDownIcon,
  ArrowUpIcon,
  BoldIcon,
  ClearFormattingIcon,
  CutIcon,
  InlineCodeIcon,
  ItalicIcon,
  PasteIcon,
  StrikeIcon,
  TrashIcon,
  TurnIntoIcon,
  UnlinkIcon,
} from './format-icons.tsx'

const ICONS = [
  ['BoldIcon', BoldIcon],
  ['ItalicIcon', ItalicIcon],
  ['StrikeIcon', StrikeIcon],
  ['InlineCodeIcon', InlineCodeIcon],
  ['ClearFormattingIcon', ClearFormattingIcon],
  ['TurnIntoIcon', TurnIntoIcon],
  ['UnlinkIcon', UnlinkIcon],
  ['CutIcon', CutIcon],
  ['PasteIcon', PasteIcon],
  ['TrashIcon', TrashIcon],
  ['ArrowUpIcon', ArrowUpIcon],
  ['ArrowDownIcon', ArrowDownIcon],
] as const

describe('the formatting icons', () => {
  it.each(ICONS)('%s is decorative and sized with the text', (_name, Icon) => {
    const { container } = render(<Icon className="extra" />)
    const svg = container.querySelector('svg')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).toHaveAttribute('focusable', 'false')
    expect(svg?.getAttribute('class')).toContain('extra')
  })
})
