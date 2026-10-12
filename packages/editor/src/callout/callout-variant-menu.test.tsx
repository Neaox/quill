import { parseDocument, serializeDocument } from '@quill/markdown'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DocumentEditor } from '../document/document-editor.tsx'
import type { DocumentEditorHandle } from '../document/document-editor.tsx'
import { expectNoAccessibilityViolations } from '../testing/axe.ts'
import { isOnIcon } from './callout-variant-menu.tsx'

const UNTITLED = 'Before.\n\n:::callout{type=warning}\nMind the gap.\n:::\n'
const TITLED = 'Before.\n\n:::callout[Heads up]{type=warning}\nMind the gap.\n:::\n'

function open(source: string) {
  const ref = createRef<DocumentEditorHandle>()
  const result = render(<DocumentEditor ast={parseDocument(source).ast} ref={ref} />)
  return {
    ref,
    user: userEvent.setup(),
    markdown: () =>
      serializeDocument({
        frontMatter: {},
        ast: ref.current?.toMdast() ?? { type: 'root', children: [] },
      }),
    ...result,
  }
}

/** jsdom draws no pseudo-elements, so the icon beside a heading is given a width. */
function withIconWidth(width: number): void {
  const real = window.getComputedStyle.bind(window)
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) =>
    pseudo === '::before'
      ? ({ width: `${String(width)}px` } as CSSStyleDeclaration)
      : real(element, pseudo),
  )
}

const menu = (): HTMLElement => screen.getByRole('menu', { name: 'Callout type' })

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the icon of a callout’s heading', () => {
  const rect = { left: 100 } as DOMRect

  it('is what is within its width of the heading’s start', () => {
    expect(isOnIcon(rect, 105, 20)).toBe(true)
    expect(isOnIcon(rect, 119, 20)).toBe(true)
    expect(isOnIcon(rect, 125, 20)).toBe(false)
    expect(isOnIcon(rect, 90, 20)).toBe(false)
  })

  it('is nothing where the browser cannot say how wide it is', () => {
    expect(isOnIcon(rect, 105, Number.NaN)).toBe(false)
  })
})

describe('changing a callout’s type from the callout itself', () => {
  it('opens on a click on the type’s name, with the type it is chosen, and the others to choose', async () => {
    const opened = open(UNTITLED)

    await opened.user.click(opened.container.querySelector('.callout-label') as HTMLElement)

    const radios = within(menu()).getAllByRole('menuitemradio')
    expect(radios.map((item) => item.textContent)).toEqual(
      ['Note', 'Info', 'Tip', 'Important', 'Warning', 'Caution'].map((name) =>
        expect.stringContaining(name),
      ),
    )
    expect(within(menu()).getByRole('menuitemradio', { name: /Warning/ })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })

  it('changes the type, keeps the text, and closes with the caret in the callout', async () => {
    const opened = open(UNTITLED)
    await opened.user.click(opened.container.querySelector('.callout-label') as HTMLElement)

    await opened.user.click(within(menu()).getByRole('menuitemradio', { name: /Tip/ }))

    expect(opened.markdown()).toBe('Before.\n\n:::callout{type="tip"}\nMind the gap.\n:::\n')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(opened.ref.current?.editor?.isFocused).toBe(true)
  })

  it('opens from the icon of a title of the callout’s own', async () => {
    const opened = open(TITLED)
    const title = opened.container.querySelector<HTMLElement>('p[data-directive-label]')
    if (title === null) throw new Error('There is no title.')
    withIconWidth(20)
    vi.spyOn(title, 'getBoundingClientRect').mockReturnValue({ left: 100 } as DOMRect)

    fireEvent.click(title, { clientX: 108 })

    expect(menu()).toBeVisible()
  })

  it('leaves a click on the words of a title for typing in it', () => {
    const opened = open(TITLED)
    const title = opened.container.querySelector<HTMLElement>('p[data-directive-label]')
    if (title === null) throw new Error('There is no title.')
    withIconWidth(20)
    vi.spyOn(title, 'getBoundingClientRect').mockReturnValue({ left: 100 } as DOMRect)

    fireEvent.click(title, { clientX: 180 })

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('closes on Escape, and gives the document its focus back', async () => {
    const opened = open(UNTITLED)
    await opened.user.click(opened.container.querySelector('.callout-label') as HTMLElement)

    await opened.user.keyboard('{Escape}')

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(opened.ref.current?.editor?.isFocused).toBe(true)
  })

  it('leaves a click anywhere else in the document alone', async () => {
    const opened = open(UNTITLED)

    await opened.user.click(screen.getByText('Mind the gap.'))
    await opened.user.click(screen.getByText('Before.'))

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('does not open in a document that cannot be edited', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <DocumentEditor ast={parseDocument(UNTITLED).ast} editable={false} />,
    )

    await user.click(container.querySelector('.callout-label') as HTMLElement)

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('is accessible while it is open', async () => {
    const opened = open(UNTITLED)
    await opened.user.click(opened.container.querySelector('.callout-label') as HTMLElement)

    await expectNoAccessibilityViolations(opened.container)
  })
})
