import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { DocumentIcon, LinkIcon } from './icons.tsx'
import {
  ParagraphIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  Heading4Icon,
  BulletListIcon,
  NumberedListIcon,
  TaskListIcon,
  QuoteIcon,
  DividerIcon,
  CalloutIcon,
  FigureIcon,
  CardsIcon,
  WidthIcon,
  NotesIcon,
  ImageIcon,
  DiagramIcon,
  DrawingIcon,
  CodeIcon,
  CodeGroupIcon,
  TableIcon,
  BadgeIcon,
  LabelIcon,
  EmojiIcon,
  FootnoteIcon,
  SmallPrintIcon,
  KeyboardIcon,
  PlaceholderIcon,
  GuidanceIcon,
  OptionalIcon,
  RepeatIcon,
  DetailsIcon,
  AccordionIcon,
  TableOfContentsIcon,
  ChildPagesIcon,
} from './block-icons.tsx'

const ICONS = [
  ['ParagraphIcon', ParagraphIcon],
  ['Heading1Icon', Heading1Icon],
  ['Heading2Icon', Heading2Icon],
  ['Heading3Icon', Heading3Icon],
  ['Heading4Icon', Heading4Icon],
  ['BulletListIcon', BulletListIcon],
  ['NumberedListIcon', NumberedListIcon],
  ['TaskListIcon', TaskListIcon],
  ['QuoteIcon', QuoteIcon],
  ['DividerIcon', DividerIcon],
  ['CalloutIcon', CalloutIcon],
  ['FigureIcon', FigureIcon],
  ['CardsIcon', CardsIcon],
  ['WidthIcon', WidthIcon],
  ['NotesIcon', NotesIcon],
  ['ImageIcon', ImageIcon],
  ['DiagramIcon', DiagramIcon],
  ['DrawingIcon', DrawingIcon],
  ['CodeIcon', CodeIcon],
  ['CodeGroupIcon', CodeGroupIcon],
  ['TableIcon', TableIcon],
  ['BadgeIcon', BadgeIcon],
  ['LabelIcon', LabelIcon],
  ['EmojiIcon', EmojiIcon],
  ['FootnoteIcon', FootnoteIcon],
  ['SmallPrintIcon', SmallPrintIcon],
  ['KeyboardIcon', KeyboardIcon],
  ['PlaceholderIcon', PlaceholderIcon],
  ['GuidanceIcon', GuidanceIcon],
  ['OptionalIcon', OptionalIcon],
  ['RepeatIcon', RepeatIcon],
  ['DetailsIcon', DetailsIcon],
  ['AccordionIcon', AccordionIcon],
  ['TableOfContentsIcon', TableOfContentsIcon],
  ['ChildPagesIcon', ChildPagesIcon],
] as const

describe('block icons', () => {
  it.each(ICONS)('%s is hidden from assistive technology and out of the tab order', (_, Icon) => {
    const { container } = render(<Icon className="text-accent" />)

    const svg = container.querySelector('svg')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).toHaveAttribute('focusable', 'false')
    expect(svg).toHaveClass('size-4', 'text-accent')
  })

  it('draws a different glyph for each block, and none the general set already has', () => {
    const shapes = new Set<string>()
    for (const Icon of [...ICONS.map(([, icon]) => icon), DocumentIcon, LinkIcon]) {
      const { container, unmount } = render(<Icon />)
      shapes.add(container.querySelector('svg')?.innerHTML ?? '')
      unmount()
    }

    expect(shapes.size).toBe(ICONS.length + 2)
  })
})
