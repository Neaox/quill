/**
 * The page's share of a large paste, cut into slices that each fit in half a
 * frame (quill-plan.md section 31: no main-thread task over 50 ms, and typing,
 * scrolling and selecting never wait for a paste).
 *
 * Most of what a slice costs is the browser building its blocks' DOM, which
 * cannot be timed before it happens. So each block is given a weight for what
 * there is to draw — its nodes and its text (`blockWeight`) — and the slicer
 * learns two numbers from the slices it has timed: what a slice costs before
 * any block in it, and what a unit of weight costs on this page, on this
 * machine. It fits them as it goes by recursive least squares, forgetting old
 * slices slowly so it follows a page that slows down, and plans each slice a
 * little short of the budget for the error left. Two numbers rather than one
 * per kind of block, because the slices of a long document are much alike, and
 * a model that tried to tell a heading's cost from a table's in slices that
 * always hold both would only guess.
 *
 * It starts by believing drawing dear, so the first blocks go on screen in a
 * short slice at once, and settles within a few slices on what it costs.
 */

/** Half a frame at 60 Hz: what a slice may take, leaving the rest of the frame to the page. */
export const SLICE_BUDGET_MS = 8

/** What a slice is taken to cost before any block in it, at first. */
const UNSEEN_SLICE_MS = 0.5

/** What a unit of weight is taken to cost at first: dear, so the first slice is short. */
const UNSEEN_UNIT_MS = 0.05

/** How much of the budget a slice is planned to fill, leaving room for the model's error. */
const PLANNED_SHARE = 0.85

/** How much each slice weighs against the one before: just under one, so old slices fade. */
const FORGETTING = 0.95

/** How unsure the model starts: large, so the first slices teach it. */
const UNSURE = 1000

/** Nothing is believed to cost less than this, so no slice is planned unbounded. */
const CHEAPEST_MS = 0.000_1

/** The weight of a block for what there is to draw: its nodes, and its text by the hundred characters. */
export interface WeighedNode {
  readonly text?: string
  readonly content?: readonly WeighedNode[]
}

export function blockWeight(block: WeighedNode): number {
  let weight = 0
  const stack = [block]
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    weight += 1 + (node.text?.length ?? 0) / 100
    stack.push(...(node.content ?? []))
  }
  return weight
}

export interface Slicer {
  /** What a slice may be planned to cost, in milliseconds, its own cost included. */
  readonly budget: number
  /** What a slice is expected to cost before any block in it. */
  overhead(): number
  /** What a unit of weight is expected to cost. */
  rate(): number
  /** What a slice of blocks weighing `weight` cost, in milliseconds. */
  record(weight: number, milliseconds: number): void
}

export function createSlicer(budget: number = SLICE_BUDGET_MS): Slicer {
  // The model: milliseconds = perSlice + perUnit * weight.
  let perSlice = UNSEEN_SLICE_MS
  let perUnit = UNSEEN_UNIT_MS
  // How unsure it is of each, and of the two together.
  let p11 = UNSURE
  let p12 = 0
  let p22 = UNSURE
  const overhead = () => Math.max(CHEAPEST_MS, perSlice)
  return {
    // A slice that costs more than half a frame before any block in it — a
    // slow phone, a long document — would land one block at a time and pay
    // that cost for each; it takes half a frame of blocks on top instead.
    get budget() {
      return Math.max(budget * PLANNED_SHARE, overhead() + budget / 2)
    },
    overhead,
    rate: () => Math.max(CHEAPEST_MS, perUnit),
    record(weight, milliseconds) {
      if (weight <= 0) return
      // Recursive least squares on [1, weight].
      const s1 = p11 + p12 * weight
      const s2 = p12 + p22 * weight
      const denominator = FORGETTING + s1 + weight * s2
      const k1 = s1 / denominator
      const k2 = s2 / denominator
      const error = milliseconds - (perSlice + perUnit * weight)
      perSlice += k1 * error
      perUnit += k2 * error
      p11 = (p11 - k1 * s1) / FORGETTING
      p12 = (p12 - k1 * s2) / FORGETTING
      p22 = (p22 - k2 * s2) / FORGETTING
    },
  }
}

/** Where time comes from, and how the page is given its turn: the browser's, or a test's. */
export interface SliceHost {
  now(): number
  /** Resolves in a later task, once the page has had its turn: a keystroke, a scroll, a frame. */
  yield(): Promise<void>
}

/** The slice of the global scope the browser host reads. */
export interface SliceScope {
  readonly performance: Pick<Performance, 'now'>
  readonly scheduler?: { yield?(): Promise<void> } | undefined
  readonly requestAnimationFrame?: ((callback: FrameRequestCallback) => number) | undefined
}

/**
 * The least work between two frames: about one, so that where drawing is
 * cheap the paste is drawn as smoothly as it lands.
 */
export const FRAME_WORK_MS = 12

/** The most: where drawing is dear, the page is still drawn twice a second. */
export const MOST_FRAME_WORK_MS = 500

/**
 * How many times longer than the browser takes to draw a frame the paste may
 * work before the next: drawing a frame of a long document costs more the
 * longer the document, and a paste that drew after every slice would spend
 * most of its time drawing what the next slice changes again.
 */
const WORK_PER_DRAW = 2

/** A message to itself: a task like a timer's, without a timer's clamped delay. */
function nextTask(): Promise<void> {
  return new Promise<void>((resolve) => {
    const channel = new MessageChannel()
    channel.port1.addEventListener('message', () => {
      channel.port1.close()
      resolve()
    })
    channel.port1.start()
    channel.port2.postMessage(null)
  })
}

/**
 * The browser's turns: `scheduler.yield()` where there is one, which resumes
 * ahead of other queued work once input has been handled, and elsewhere a
 * message to itself. Resumed ahead of everything, slices would also run ahead
 * of drawing, and the paste would land unseen; so once enough work has gone
 * by, the next slice waits until the browser has drawn what has landed. How
 * much is enough is measured, not guessed: twice what the last frame took to
 * draw, so drawing never takes more than a third of the paste's time, between
 * one frame's worth and half a second.
 */
export function browserSliceHost(scope: SliceScope): SliceHost {
  const scheduled = scope.scheduler?.yield?.bind(scope.scheduler)
  const frame = scope.requestAnimationFrame
  const now = () => scope.performance.now()
  let drawn = now()
  let between = FRAME_WORK_MS
  const turn = scheduled ?? nextTask
  return {
    now,
    async yield() {
      if (frame === undefined || now() - drawn < between) {
        await turn()
        return
      }
      // A frame's callbacks run just before it is drawn; the task after them, after.
      const drawing = await new Promise<number>((resolve) => {
        frame(() => {
          resolve(now())
        })
      })
      await nextTask()
      drawn = now()
      between = Math.min(
        MOST_FRAME_WORK_MS,
        Math.max(FRAME_WORK_MS, (drawn - drawing) * WORK_PER_DRAW),
      )
    },
  }
}
