import { describe, expect, it, vi } from 'vitest'

import { revealPosition } from './reveal.ts'
import type { NextFrame, RevealView } from './reveal.ts'

const VIEWPORT = 800
const CLEAR_TOP = 150

type Rect = { readonly top: number; readonly bottom: number }

/**
 * An editor root holding a top-level list whose item's paragraph holds position `7`, drawn at
 * each of `rects` in turn: where it seemed to be, and where it is once its block has been drawn.
 */
function viewWith(...rects: readonly Rect[]) {
  const root = document.createElement('div')
  const list = document.createElement('ul')
  const paragraph = document.createElement('p')
  paragraph.append(document.createTextNode('some words'))
  list.append(paragraph)
  root.append(list)
  const scrolled: string[] = []
  list.scrollIntoView = vi.fn<(options?: boolean | ScrollIntoViewOptions) => void>(() => {
    scrolled.push('block')
  })
  paragraph.scrollIntoView = vi.fn<(options?: boolean | ScrollIntoViewOptions) => void>(() => {
    scrolled.push('match')
  })
  let measured = 0
  const view: RevealView = {
    dom: root,
    coordsAtPos: () => {
      const rect = rects[Math.min(measured, rects.length - 1)] ?? { top: 0, bottom: 0 }
      measured += 1
      return rect
    },
    domAtPos: () => ({ node: paragraph.firstChild ?? paragraph }),
  }
  return { view, scrolled, list, paragraph }
}

/** Frames that run when the test says, as the browser's would after the scroll. */
function frames() {
  const pending: (() => void)[] = []
  const next: NextFrame = (callback) => {
    pending.push(callback)
  }
  const flush = () => {
    for (const callback of pending.splice(0)) callback()
  }
  return { next, flush }
}

describe('bringing a match into view', () => {
  it('leaves the page where it is when the match is already clear of the bar and the bottom edge', () => {
    const { view, scrolled } = viewWith({ top: 300, bottom: 320 })
    const frame = frames()

    revealPosition(view, 7, CLEAR_TOP, VIEWPORT, frame.next)
    frame.flush()

    expect(scrolled).toEqual([])
  })

  it.each([
    ['above the viewport', -40, -20],
    ['behind the bar', 100, 120],
    ['below the viewport', 900, 920],
  ])('centres its block when it is %s', (_where, top, bottom) => {
    const { view, list } = viewWith({ top, bottom }, { top: 400, bottom: 420 })
    const frame = frames()

    revealPosition(view, 7, CLEAR_TOP, VIEWPORT, frame.next)
    frame.flush()

    expect(list.scrollIntoView).toHaveBeenCalledWith({ block: 'center', inline: 'nearest' })
  })

  it('scrolls to the block first, so a block the browser skipped is drawn, and then centres the match where it really is', () => {
    // Skipped (content-visibility: auto), the block stood at a guessed height: once it and its
    // neighbours are drawn, the match is still below the fold.
    const { view, scrolled, paragraph } = viewWith(
      { top: 5_000, bottom: 5_020 },
      { top: 1_300, bottom: 1_320 },
    )
    const frame = frames()

    revealPosition(view, 7, CLEAR_TOP, VIEWPORT, frame.next)
    expect(scrolled).toEqual(['block'])

    frame.flush()
    expect(scrolled).toEqual(['block', 'match'])
    expect(paragraph.scrollIntoView).toHaveBeenCalledWith({ block: 'center', inline: 'nearest' })
  })

  it('stops at the block when, once it is drawn, the match is in view', () => {
    const { view, scrolled } = viewWith({ top: 5_000, bottom: 5_020 }, { top: 400, bottom: 420 })
    const frame = frames()

    revealPosition(view, 7, CLEAR_TOP, VIEWPORT, frame.next)
    frame.flush()

    expect(scrolled).toEqual(['block'])
  })

  it('scrolls the element when the position is in an element rather than in text', () => {
    const root = document.createElement('div')
    const element = document.createElement('p')
    root.append(element)
    const scrollIntoView = vi.fn<(options?: boolean | ScrollIntoViewOptions) => void>()
    element.scrollIntoView = scrollIntoView
    const view: RevealView = {
      dom: root,
      coordsAtPos: () => ({ top: 900, bottom: 920 }),
      domAtPos: () => ({ node: element }),
    }
    const frame = frames()

    revealPosition(view, 7, CLEAR_TOP, VIEWPORT, frame.next)
    frame.flush()

    // The paragraph is both the top-level block and the match's element.
    expect(scrollIntoView).toHaveBeenCalledTimes(2)
  })

  it('does nothing for a position that is in no element at all', () => {
    const view: RevealView = {
      dom: document.createElement('div'),
      coordsAtPos: () => ({ top: 900, bottom: 920 }),
      domAtPos: () => ({ node: document.createTextNode('adrift') }),
    }

    expect(() => {
      revealPosition(view, 7, CLEAR_TOP, VIEWPORT, frames().next)
    }).not.toThrow()
  })

  it('does nothing for a view with no layout to measure, such as one in a test', () => {
    const element = document.createElement('p')
    const scrollIntoView = vi.fn<(options?: boolean | ScrollIntoViewOptions) => void>()
    element.scrollIntoView = scrollIntoView
    const view: RevealView = {
      dom: document.createElement('div'),
      coordsAtPos: () => {
        throw new Error('No layout.')
      },
      domAtPos: () => ({ node: element }),
    }

    revealPosition(view, 7, CLEAR_TOP, VIEWPORT, frames().next)

    expect(scrollIntoView).not.toHaveBeenCalled()
  })
})
