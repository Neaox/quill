import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CloseIcon,
  CollectionIcon,
  CommentIcon,
  CopyIcon,
  DangerIcon,
  DocumentIcon,
  ChevronUpIcon,
  CompareIcon,
  DropdownIcon,
  ExternalIcon,
  HistoryIcon,
  InfoIcon,
  LinkIcon,
  OutlineIcon,
  PencilIcon,
  PlusIcon,
  PresentIcon,
  PreviewIcon,
  RestoreIcon,
  SearchIcon,
  SettingsIcon,
  ShareIcon,
  SignOutIcon,
  SuccessIcon,
  SwapIcon,
  UserIcon,
  WarningIcon,
  WorkspacesIcon,
} from './icons.tsx'

const ICONS = [
  ['InfoIcon', InfoIcon],
  ['SuccessIcon', SuccessIcon],
  ['WarningIcon', WarningIcon],
  ['DangerIcon', DangerIcon],
  ['ChevronRightIcon', ChevronRightIcon],
  ['ChevronDownIcon', ChevronDownIcon],
  ['CheckIcon', CheckIcon],
  ['CloseIcon', CloseIcon],
  ['OutlineIcon', OutlineIcon],
  ['SearchIcon', SearchIcon],
  ['HistoryIcon', HistoryIcon],
  ['CommentIcon', CommentIcon],
  ['CopyIcon', CopyIcon],
  ['PlusIcon', PlusIcon],
  ['PencilIcon', PencilIcon],
  ['PresentIcon', PresentIcon],
  ['PreviewIcon', PreviewIcon],
  ['ShareIcon', ShareIcon],
  ['DocumentIcon', DocumentIcon],
  ['CollectionIcon', CollectionIcon],
  ['LinkIcon', LinkIcon],
  ['ExternalIcon', ExternalIcon],
  ['DropdownIcon', DropdownIcon],
  ['CompareIcon', CompareIcon],
  ['SwapIcon', SwapIcon],
  ['ChevronUpIcon', ChevronUpIcon],
  ['RestoreIcon', RestoreIcon],
  ['SettingsIcon', SettingsIcon],
  ['UserIcon', UserIcon],
  ['SignOutIcon', SignOutIcon],
  ['WorkspacesIcon', WorkspacesIcon],
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
