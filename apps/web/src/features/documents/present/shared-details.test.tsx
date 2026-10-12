import { renderHook } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createDetailsStore, useShareDetails, type OpenSections } from './shared-details.ts'

/** Two slides, each marked with its step, as the presentation windows draw them. */
function drawSlides(): void {
  document.body.innerHTML = `
    <section data-step="0">
      <details><summary>First</summary>one</details>
      <details open><summary>Second</summary>two</details>
    </section>
    <section data-step="1">
      <details name="faq"><summary>Third</summary>three</details>
      <details name="faq"><summary>Fourth</summary>four</details>
    </section>
    <section><details><summary>Unmarked</summary>not a slide</details></section>`
}

const summary = (name: string): HTMLElement => {
  const found = [...document.querySelectorAll('summary')].find((el) => el.textContent === name)
  if (found === undefined) throw new Error(`No summary ${name}`)
  return found
}

const openStates = (step: number): OpenSections =>
  [
    ...(document.querySelector(`[data-step="${String(step)}"]`)?.querySelectorAll('details') ?? []),
  ].map((section) => section.open)

afterEach(() => {
  document.body.innerHTML = ''
})

const listening = () => {
  const announce = vi.fn<(step: number, open: OpenSections) => void>()
  const store = createDetailsStore()
  const view = renderHook(() => {
    useShareDetails(store, announce)
  })
  return { announce, store, ...view }
}

describe('useShareDetails', () => {
  it('says which slide’s sections now are open, after one is opened', async () => {
    drawSlides()
    const { announce } = listening()

    await userEvent.click(summary('Third'))

    await vi.waitFor(() => {
      expect(announce).toHaveBeenCalledExactlyOnceWith(1, [true, false])
    })
  })

  it('says a section was folded', async () => {
    drawSlides()
    const { announce } = listening()

    await userEvent.click(summary('Second'))

    await vi.waitFor(() => {
      expect(announce).toHaveBeenCalledExactlyOnceWith(0, [false, false])
    })
  })

  it('remembers what a person did, to tell a window that arrives later', async () => {
    drawSlides()
    const { announce, store } = listening()

    await userEvent.click(summary('First'))

    await vi.waitFor(() => {
      expect(announce).toHaveBeenCalled()
    })
    expect(store.remembered().get(0)).toEqual([true, true])
  })

  it('says nothing about something that is not a slide', async () => {
    drawSlides()
    const { announce } = listening()

    await userEvent.click(summary('Unmarked'))
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(announce).not.toHaveBeenCalled()
  })

  it('stops listening when the window does', async () => {
    drawSlides()
    const { announce, unmount } = listening()
    unmount()

    await userEvent.click(summary('First'))
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(announce).not.toHaveBeenCalled()
  })
})

describe('createDetailsStore', () => {
  it('draws what it is told onto the slide, without a click', () => {
    drawSlides()
    const store = createDetailsStore()

    store.remember(0, [true, false])

    expect(openStates(0)).toEqual([true, false])
  })

  it('draws what it remembers onto a slide that appears afterwards', () => {
    const store = createDetailsStore()
    store.remember(0, [true, false])
    store.remember(1, [false, true])

    drawSlides()
    expect(openStates(0)).toEqual([false, true])

    store.draw()

    expect(openStates(0)).toEqual([true, false])
    expect(openStates(1)).toEqual([false, true])
  })

  it('leaves a slide this window lacks, a section it lacks, and an answer that is not one, alone', () => {
    drawSlides()
    const store = createDetailsStore()

    expect(() => {
      store.remember(7, [true])
      store.remember(0, [true, false, true])
      // What an unrelated message on the origin's channel could carry.
      store.remember(1, ['yes', null] as never)
    }).not.toThrow()

    expect(openStates(0)).toEqual([true, false])
    expect(openStates(1)).toEqual([false, false])
  })

  it('knows nothing until somebody opens or folds something', () => {
    expect(createDetailsStore().remembered().size).toBe(0)
  })
})
