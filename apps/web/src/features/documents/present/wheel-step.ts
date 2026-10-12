/**
 * The scroll wheel as a way to step through a presentation, and when it is not one.
 *
 * A wheel (or a trackpad) is a natural remote: a turn forward is the next section. It is not
 * always the presenter's to take, though: over the notes, or over a section taller than the
 * screen, the wheel is for scrolling that, and only when there is nothing left to scroll in that
 * direction does it step. A trackpad sends a stream of small events for one swipe, so a step needs
 * a swipe's worth of travel, and a pause before the next, or one flick would run through the deck.
 */

/** How far the wheel has to turn, in pixels, for one step: a notch of a mouse wheel, or a swipe's worth. */
export const STEP_DISTANCE = 60

/** After a step, the wheel is ignored for this long (milliseconds), so a swipe's tail is not a second step. */
export const STEP_COOLDOWN_MS = 350

/** A pause this long (milliseconds) between events is a new gesture, not the same one. */
export const GESTURE_PAUSE_MS = 200

/** How near an end counts as being at it: sizes are rounded, and a scaled slide stops short of them. */
const END_SLACK = 2

const LINE_HEIGHT = 16
const PAGE_HEIGHT = 100

/** The wheel's travel in pixels, whatever unit the device reports it in. */
export function wheelPixels(event: Pick<WheelEvent, 'deltaY' | 'deltaMode'>): number {
  if (event.deltaMode === 1) return event.deltaY * LINE_HEIGHT
  if (event.deltaMode === 2) return event.deltaY * PAGE_HEIGHT
  return event.deltaY
}

function scrollsVertically(element: Element): boolean {
  const { overflowY } = getComputedStyle(element)
  return (
    (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') &&
    element.scrollHeight > element.clientHeight
  )
}

/** Whether something under the pointer still has room to scroll the way the wheel is turning. */
export function canScrollFurther(target: EventTarget | null, travel: number): boolean {
  for (
    let element = target instanceof Element ? target : null;
    element !== null;
    element = element.parentElement
  ) {
    if (element === document.documentElement || element === document.body) break
    if (!scrollsVertically(element)) continue
    const atEnd = element.scrollTop + element.clientHeight >= element.scrollHeight - END_SLACK
    if (travel > 0 ? !atEnd : element.scrollTop > END_SLACK) return true
  }
  // The page itself, for a section taller than the window.
  const page = document.scrollingElement
  // (A document with no layout, as in a test, has no scrolling element at all.)
  if (!(page instanceof Element)) return false
  const atEnd = page.scrollTop + page.clientHeight >= page.scrollHeight - END_SLACK
  const scrolls = page.scrollHeight > page.clientHeight
  return scrolls && (travel > 0 ? !atEnd : page.scrollTop > END_SLACK)
}

export interface WheelGesture {
  /** What the wheel has travelled in this gesture, signed. */
  travelled: number
  /** The time of the last event of this gesture (`event.timeStamp`). */
  lastAt: number
  /** The time of the last step taken. */
  steppedAt: number
}

export const NEW_GESTURE: WheelGesture = {
  travelled: 0,
  lastAt: Number.NEGATIVE_INFINITY,
  steppedAt: Number.NEGATIVE_INFINITY,
}

/**
 * What one wheel event adds to a gesture, and whether it completes a step. Pure: the clock is the
 * event's own time, and the caller keeps the gesture between events.
 */
export function advanceGesture(
  gesture: WheelGesture,
  travel: number,
  at: number,
): { readonly gesture: WheelGesture; readonly step: 'next' | 'previous' | undefined } {
  // Still turning from the step just taken: nothing to add.
  if (at - gesture.steppedAt < STEP_COOLDOWN_MS) {
    return { gesture: { ...gesture, lastAt: at }, step: undefined }
  }
  const resumed = at - gesture.lastAt > GESTURE_PAUSE_MS
  const travelled = (resumed ? 0 : gesture.travelled) + travel
  if (Math.abs(travelled) >= STEP_DISTANCE) {
    return {
      gesture: { travelled: 0, lastAt: at, steppedAt: at },
      step: travelled > 0 ? 'next' : 'previous',
    }
  }
  return { gesture: { ...gesture, travelled, lastAt: at }, step: undefined }
}
