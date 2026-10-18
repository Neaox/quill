import { describe, expect, it } from 'vitest'

import {
  FRAME_WORK_MS,
  MOST_FRAME_WORK_MS,
  SLICE_BUDGET_MS,
  blockWeight,
  browserSliceHost,
  createSlicer,
} from './time-slice.ts'

/**
 * The page's share of a large paste is cut into slices that each fit in half
 * a frame (quill-plan.md section 31: no main-thread task over 50 ms, typing
 * never blocked). What a slice costs cannot be known before it runs — most of
 * it is the browser drawing the blocks — so the slicer learns it from the
 * slices before, against each block's weight; a fake clock stands in for the
 * browser's.
 */

interface Block {
  readonly weight: number
  /** What it really costs to draw, which the slicer never sees. */
  readonly ms: number
}

/** The runbook's shape: a heading, a paragraph, a list, a table and a code block, again and again. */
function runbook(scale = 1): Block[] {
  const section: Block[] = [
    // Each kind costs a different amount for its weight, as the browser's do.
    { weight: 2, ms: 0.05 },
    { weight: 8, ms: 0.12 },
    { weight: 10, ms: 0.3 },
    { weight: 30, ms: 1 },
    { weight: 3, ms: 0.2 },
  ]
  return Array.from({ length: 240 }, () =>
    section.map((block) => ({ ...block, ms: block.ms * scale })),
  ).flat()
}

/** Lands `blocks` through the slicer, charging what each block and each slice really cost. */
function land(blocks: readonly Block[], overhead: number) {
  const slicer = createSlicer()
  const slices: { blocks: number; ms: number; dearest: number }[] = []
  let next = 0
  while (next < blocks.length) {
    const taken: Block[] = []
    let planned = slicer.overhead()
    // A slice always takes one block, then as many as are expected to fit.
    for (let block = blocks[next]; block !== undefined; block = blocks[next]) {
      const cost = slicer.rate() * block.weight
      if (taken.length > 0 && planned + cost > slicer.budget) break
      planned += cost
      taken.push(block)
      next += 1
    }
    const ms = overhead + taken.reduce((sum, block) => sum + block.ms, 0)
    slicer.record(
      taken.reduce((sum, block) => sum + block.weight, 0),
      ms,
    )
    slices.push({ blocks: taken.length, ms, dearest: Math.max(...taken.map((block) => block.ms)) })
  }
  return slices
}

/** The slices after the first few, from which it has learned. */
const settled = <T>(slices: readonly T[]) => slices.slice(10)

describe('slicing the page’s work', () => {
  it('starts with a short slice, so the first blocks are on screen at once', () => {
    const [first] = land(runbook(), 0.5)
    expect(first?.ms).toBeLessThan(SLICE_BUDGET_MS)
    expect(first?.blocks).toBeLessThanOrEqual(15)
  })

  it('keeps slices inside half a frame once it has learned what drawing costs', () => {
    const slices = settled(land(runbook(), 0.5))
    const within = slices.filter((slice) => slice.ms <= SLICE_BUDGET_MS)
    expect(within.length / slices.length).toBeGreaterThan(0.9)
    // What goes over is a dear block, never much the slicer added to it.
    expect(slices.every((slice) => slice.ms - slice.dearest <= SLICE_BUDGET_MS)).toBe(true)
  })

  it('fills each slice rather than landing one block at a time', () => {
    const slices = land(runbook(), 0.5)
    expect(slices.length).toBeLessThan(runbook().length / 3)
  })

  it('takes fewer blocks when the page slows down, as a throttled phone does', () => {
    const quick = land(runbook(), 0.5)
    const slow = land(runbook(4), 2)
    expect(slow.length).toBeGreaterThan(quick.length * 2)
    expect(settled(slow).every((slice) => slice.ms - slice.dearest <= SLICE_BUDGET_MS)).toBe(true)
  })

  it('still takes several blocks a slice when a slice costs more than half a frame on its own', () => {
    const slices = settled(land(runbook(), 12))
    expect(slices.reduce((sum, slice) => sum + slice.blocks, 0) / slices.length).toBeGreaterThan(2)
    expect(slices.every((slice) => slice.ms - 12 - slice.dearest <= SLICE_BUDGET_MS)).toBe(true)
  })

  it('goes over only by a block too dear for half a frame on its own', () => {
    const dear = runbook().map((block) => (block.weight === 3 ? { ...block, ms: 12 } : block))
    const slices = settled(land(dear, 0.5))
    expect(slices.every((slice) => slice.ms - slice.dearest <= SLICE_BUDGET_MS)).toBe(true)
  })

  it('learns nothing from a slice that held nothing', () => {
    const slicer = createSlicer()
    slicer.record(0, 40)
    expect(slicer.overhead()).toBe(createSlicer().overhead())
    expect(slicer.rate()).toBe(createSlicer().rate())
  })

  it('weighs a block by its nodes and its text', () => {
    expect(blockWeight({})).toBe(1)
    expect(blockWeight({ content: [{ text: 'x'.repeat(200) }, {}] })).toBe(1 + 3 + 1)
  })

  it('gives the page back its turn with the scheduler where there is one', async () => {
    const yielded: string[] = []
    const host = browserSliceHost({
      performance: { now: () => 1 },
      scheduler: {
        yield: async () => {
          yielded.push('scheduler')
        },
      },
    })
    await host.yield()
    expect(yielded).toEqual(['scheduler'])
    expect(host.now()).toBe(1)
  })

  it('gives it back with a message to itself where there is no scheduler', async () => {
    const host = browserSliceHost({ performance })
    await expect(host.yield()).resolves.toBeUndefined()
  })
})

/** A page whose clock and frames the test turns by hand. */
function page(drawMs: number) {
  let clock = 0
  const frames: FrameRequestCallback[] = []
  const turns: string[] = []
  const host = browserSliceHost({
    performance: { now: () => clock },
    scheduler: {
      yield: async () => {
        turns.push('turn')
      },
    },
    requestAnimationFrame: (callback) => {
      frames.push(callback)
      return frames.length
    },
  })
  return {
    host,
    turns,
    frames,
    work(ms: number) {
      clock += ms
    },
    /** Draws the frame asked for, which takes `drawMs`, and lets the paste go on. */
    async draw() {
      const callback = frames.shift()
      callback?.(clock)
      clock += drawMs
      await new Promise((resolve) => setTimeout(resolve, 0))
    },
  }
}

describe('letting the browser draw what has landed', () => {
  it('waits for a frame once a frame’s worth of work has gone by, not before', async () => {
    const browser = page(4)
    browser.work(FRAME_WORK_MS / 2)
    await browser.host.yield()
    expect(browser.frames).toHaveLength(0)
    browser.work(FRAME_WORK_MS)
    const waiting = browser.host.yield()
    expect(browser.frames).toHaveLength(1)
    await browser.draw()
    await waiting
    expect(browser.turns).toEqual(['turn'])
  })

  it('works longer between frames that are dear to draw, up to half a second', async () => {
    const dear = page(400)
    dear.work(FRAME_WORK_MS)
    const first = dear.host.yield()
    await dear.draw()
    await first
    // Drawing took 400 ms, so the next frame waits for twice that, at most half a second.
    dear.work(MOST_FRAME_WORK_MS - 1)
    await dear.host.yield()
    expect(dear.frames).toHaveLength(0)
    dear.work(1)
    void dear.host.yield()
    expect(dear.frames).toHaveLength(1)
  })
})
