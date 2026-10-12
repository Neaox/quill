import { describe, expect, it, vi } from 'vitest'

import { revealPosition } from './reveal.ts'
import type { RevealView } from './reveal.ts'

const VIEWPORT = 800
const CLEAR_TOP = 150

/** A view whose position `7` is drawn between `top` and `bottom`, in a paragraph that scrolls into view when asked. */
function viewWith(top: number, bottom: number) {
  const paragraph = document.createElement('p')
  paragraph.append(document.createTextNode('some words'))
  const scrollIntoView = vi.fn<(options: ScrollIntoViewOptions) => void>()
  paragraph.scrollIntoView = scrollIntoView
  const view: RevealView = {
    coordsAtPos: () => ({ top, bottom }),
    domAtPos: () => ({ node: paragraph.firstChild ?? paragraph }),
  }
  return { view, scrollIntoView }
}

describe('bringing a match into view', () => {
  it('leaves the page where it is when the match is already clear of the bar and the bottom edge', () => {
    const { view, scrollIntoView } = viewWith(300, 320)

    revealPosition(view, 7, CLEAR_TOP, VIEWPORT)

    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it.each([
    ['above the viewport', -40, -20],
    ['behind the bar', 100, 120],
    ['below the viewport', 900, 920],
  ])('centres it when it is %s', (_where, top, bottom) => {
    const { view, scrollIntoView } = viewWith(top, bottom)

    revealPosition(view, 7, CLEAR_TOP, VIEWPORT)

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', inline: 'nearest' })
  })

  it('scrolls the element when the position is in an element rather than in text', () => {
    const element = document.createElement('p')
    const scrollIntoView = vi.fn<(options: ScrollIntoViewOptions) => void>()
    element.scrollIntoView = scrollIntoView
    const view: RevealView = {
      coordsAtPos: () => ({ top: 900, bottom: 920 }),
      domAtPos: () => ({ node: element }),
    }

    revealPosition(view, 7, CLEAR_TOP, VIEWPORT)

    expect(scrollIntoView).toHaveBeenCalledOnce()
  })

  it('does nothing for a position that is in no element at all', () => {
    const view: RevealView = {
      coordsAtPos: () => ({ top: 900, bottom: 920 }),
      domAtPos: () => ({ node: document.createTextNode('adrift') }),
    }

    expect(() => {
      revealPosition(view, 7, CLEAR_TOP, VIEWPORT)
    }).not.toThrow()
  })

  it('does nothing for a view with no layout to measure, such as one in a test', () => {
    const view: RevealView = {
      coordsAtPos: () => {
        throw new Error('No layout.')
      },
      domAtPos: () => ({ node: document.createElement('p') }),
    }

    expect(() => {
      revealPosition(view, 7, CLEAR_TOP, VIEWPORT)
    }).not.toThrow()
  })
})
