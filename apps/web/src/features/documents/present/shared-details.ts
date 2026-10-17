import { useEffect } from 'react'

/**
 * Sections that open and fold (a details, an accordion's items) kept the same in the two windows of
 * a presentation, from the moment a window arrives (ADR-050).
 *
 * The presenter window's current slide is live, so a presenter can open a section there; without
 * this the room, looking at the audience window, would not see it open. A slide is marked
 * `data-step`, and what is shared is the slide's whole row of sections, open or not, in the order
 * they appear: that names the same sections in both windows, because both draw the same HTML. The
 * next-slide picture carries no mark, so it neither speaks nor is spoken to.
 *
 * A whole row rather than one section at a time because an accordion's items close each other, and
 * a window that was told only "this one opened" would be left with another one open.
 */

const SLIDE = '[data-step]'

/** The open state of a slide's sections, in order. */
export type OpenSections = readonly boolean[]

export interface DetailsStore {
  /** A slide's sections are now like this: kept, and drawn if the slide is on the page. */
  remember(step: number, open: OpenSections): void
  /** Every slide somebody has opened or folded a section of, for a window that has just arrived. */
  remembered(): ReadonlyMap<number, OpenSections>
  /** Draws what is remembered onto the slides now on the page, which a new slide has not had yet. */
  draw(): void
}

const slideOf = (step: number): Element | null =>
  document.querySelector(`[data-step="${String(step)}"]`)

/**
 * What a window has been told about its slides' sections. A slide's sections are drawn from the
 * document's own defaults until somebody changes one; from then on this is what they are, and it
 * is drawn again wherever the slide is drawn again (going back to a slide, or a window that has
 * just opened and is told what the room has opened).
 */
export function createDetailsStore(): DetailsStore {
  const slides = new Map<number, OpenSections>()

  const drawSlide = (step: number, open: OpenSections): void => {
    const sections = slideOf(step)?.querySelectorAll('details') ?? []
    for (const [position, section] of sections.entries()) {
      const wanted = open[position]
      // A message on the channel is whatever the origin sent: only a boolean is taken as an answer.
      if (typeof wanted === 'boolean' && section.open !== wanted) section.open = wanted
    }
  }

  return {
    remember: (step, open) => {
      slides.set(step, open)
      drawSlide(step, open)
    },
    remembered: () => slides,
    draw: () => {
      for (const [step, open] of slides) drawSlide(step, open)
    },
  }
}

/**
 * Says, to `announce`, each time a person opens or folds a section of a slide, with the slide's
 * whole row of sections as it then is.
 *
 * It listens for the click that does it, not for the browser's `toggle` event, because `toggle`
 * also fires for a section that is open when it is drawn, and for one the other window just
 * changed: both would be announced as if somebody had chosen them, and could undo a choice. A
 * click is only ever a person. Where a window is told to change a section no click happens, so
 * nothing is announced back.
 */
export function useShareDetails(
  store: DetailsStore,
  announce: (step: number, open: OpenSections) => void,
): void {
  // Synchronises with the page's clicks, which the browser delivers and React does not render.
  useEffect(() => {
    const onClick = (event: MouseEvent): void => {
      if (event.defaultPrevented || !(event.target instanceof Element)) return
      const details = event.target.closest('summary')?.parentElement
      const slide = details?.closest<HTMLElement>(SLIDE)
      if (!(details instanceof HTMLDetailsElement) || slide == null) return
      // After the browser has acted on the click, and closed whatever an accordion closes with it.
      setTimeout(() => {
        const step = Number(slide.dataset['step'])
        const open = [...slide.querySelectorAll('details')].map((section) => section.open)
        store.remember(step, open)
        announce(step, open)
      }, 0)
    }
    document.addEventListener('click', onClick, true)
    return () => {
      document.removeEventListener('click', onClick, true)
    }
  }, [store, announce])
}
