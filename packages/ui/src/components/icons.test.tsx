import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  ChevronRightIcon,
  CloseIcon,
  CommentIcon,
  CopyIcon,
  DangerIcon,
  HistoryIcon,
  InfoIcon,
  OutlineIcon,
  SearchIcon,
  SuccessIcon,
  WarningIcon,
} from './icons.tsx'

const ICONS = [
  ['InfoIcon', InfoIcon],
  ['SuccessIcon', SuccessIcon],
  ['WarningIcon', WarningIcon],
  ['DangerIcon', DangerIcon],
  ['ChevronRightIcon', ChevronRightIcon],
  ['CloseIcon', CloseIcon],
  ['OutlineIcon', OutlineIcon],
  ['SearchIcon', SearchIcon],
  ['HistoryIcon', HistoryIcon],
  ['CommentIcon', CommentIcon],
  ['CopyIcon', CopyIcon],
] as const

describe('icons', () => {
  it.each(ICONS)('%s is hidden from assistive technology and out of the tab order', (_, Icon) => {
    const { container } = render(<Icon />)

    const svg = container.querySelector('svg')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).toHaveAttribute('focusable', 'false')
  })

  it.each(ICONS)('%s accepts caller classes', (_, Icon) => {
    const { container } = render(<Icon className="text-accent" />)

    expect(container.querySelector('svg')).toHaveClass('size-4', 'text-accent')
  })

  it('draws a different glyph for each icon', () => {
    const shapes = new Set<string>()
    for (const [, Icon] of ICONS) {
      const { container, unmount } = render(<Icon />)
      shapes.add(container.querySelector('svg')?.innerHTML ?? '')
      unmount()
    }

    expect(shapes.size).toBe(ICONS.length)
  })
})
