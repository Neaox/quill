import { BRAND } from '@quill/brand'
import { describe, expect, it } from 'vitest'

import { TOKEN_CLASSES, type TokenRange } from '../tokens.ts'
import { createTokenHighlightRegistry, tokenHighlightName } from './highlight-registry.ts'
import type { HighlightSetLike, TokenHighlightEnvironment } from './highlight-registry.ts'

class FakeHighlightSet implements HighlightSetLike {
  readonly ranges = new Set<unknown>()
  add(range: unknown): void {
    this.ranges.add(range)
  }
  delete(range: unknown): void {
    this.ranges.delete(range)
  }
}

function createFakeEnvironment(): TokenHighlightEnvironment & {
  highlights: Map<string, HighlightSetLike>
} {
  return {
    highlights: new Map<string, HighlightSetLike>(),
    createHighlightSet: () => new FakeHighlightSet(),
  }
}

const createRange = (range: TokenRange) => ({ marker: range })

describe('tokenHighlightName', () => {
  it(`prefixes every token class with ${BRAND.slug}-tok-`, () => {
    expect(tokenHighlightName('keyword')).toBe(`${BRAND.slug}-tok-keyword`)
  })
})

describe('createTokenHighlightRegistry', () => {
  it('registers one Highlight per token class', () => {
    const env = createFakeEnvironment()
    createTokenHighlightRegistry(env)
    expect(env.highlights.size).toBe(TOKEN_CLASSES.length)
    for (const tokenClass of TOKEN_CLASSES) {
      expect(env.highlights.has(tokenHighlightName(tokenClass))).toBe(true)
    }
  })

  it('reuses an already-registered Highlight instead of replacing it', () => {
    const env = createFakeEnvironment()
    const preexisting = new FakeHighlightSet()
    env.highlights.set(tokenHighlightName('keyword'), preexisting)
    createTokenHighlightRegistry(env)
    expect(env.highlights.get(tokenHighlightName('keyword'))).toBe(preexisting)
  })

  it('applies each range into its class Highlight and returns a disposer', () => {
    const env = createFakeEnvironment()
    const registry = createTokenHighlightRegistry(env)
    const ranges: TokenRange[] = [
      { start: 0, end: 3, type: 'keyword' },
      { start: 4, end: 7, type: 'string' },
    ]
    const dispose = registry.applyRanges(createRange, ranges)

    const keywordSet = env.highlights.get(tokenHighlightName('keyword')) as FakeHighlightSet
    const stringSet = env.highlights.get(tokenHighlightName('string')) as FakeHighlightSet
    expect(keywordSet.ranges.size).toBe(1)
    expect(stringSet.ranges.size).toBe(1)

    dispose()
    expect(keywordSet.ranges.size).toBe(0)
    expect(stringSet.ranges.size).toBe(0)
  })

  it("disposing one block's ranges leaves another block's ranges intact", () => {
    const env = createFakeEnvironment()
    const registry = createTokenHighlightRegistry(env)

    const disposeA = registry.applyRanges(createRange, [{ start: 0, end: 1, type: 'keyword' }])
    registry.applyRanges(createRange, [{ start: 2, end: 3, type: 'keyword' }])

    const keywordSet = env.highlights.get(tokenHighlightName('keyword')) as FakeHighlightSet
    expect(keywordSet.ranges.size).toBe(2)

    disposeA()
    expect(keywordSet.ranges.size).toBe(1)
  })
})
