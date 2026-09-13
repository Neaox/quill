import { BRAND } from '@quill/brand'
import { describe, expect, it } from 'vitest'

import { packRanges } from '../pack.ts'
import type { TokenRange } from '../tokens.ts'
import { applyHighlighting } from './apply-highlighting.ts'
import type {
  CodeBlockElement,
  HighlightClientEnvironment,
  HighlightRoot,
  TextNodeLike,
} from './apply-highlighting.ts'
import type { HighlightSetLike } from './highlight-registry.ts'

class FakeTextNode implements TextNodeLike {
  data: string
  constructor(data: string) {
    this.data = data
  }
}

class FakeCodeBlock implements CodeBlockElement {
  readonly childNodes: TextNodeLike[]
  #attributes: Map<string, string>
  replacedWith: unknown[] | null = null

  constructor(attributes: Record<string, string>, text: string | null) {
    this.#attributes = new Map(Object.entries(attributes))
    this.childNodes = text === null ? [] : [new FakeTextNode(text)]
  }

  getAttribute(name: string): string | null {
    return this.#attributes.get(name) ?? null
  }

  replaceChildren(...nodes: unknown[]): void {
    this.replacedWith = nodes
  }
}

class FakeRoot implements HighlightRoot {
  readonly #blocks: CodeBlockElement[]
  constructor(blocks: CodeBlockElement[]) {
    this.#blocks = blocks
  }
  querySelectorAll(): Iterable<CodeBlockElement> {
    return this.#blocks
  }
}

class FakeHighlightSet implements HighlightSetLike {
  readonly ranges = new Set<unknown>()
  add(range: unknown): void {
    this.ranges.add(range)
  }
  delete(range: unknown): void {
    this.ranges.delete(range)
  }
}

function rangesEnvironment(): HighlightClientEnvironment & {
  highlights: Map<string, HighlightSetLike>
} {
  const highlights = new Map<string, HighlightSetLike>()
  return {
    CSS: { highlights },
    Highlight: FakeHighlightSet,
    highlights,
    createRange: (node, start, end) => ({ node, start, end }),
    parseMarkup: () => [],
  }
}

function markupEnvironment(): HighlightClientEnvironment {
  return {
    createRange: (node, start, end) => ({ node, start, end }),
    parseMarkup: (html) => [{ html }],
  }
}

describe('applyHighlighting', () => {
  it('paints ranges through the registry when the Highlight API is available', () => {
    const ranges: TokenRange[] = [{ start: 0, end: 5, type: 'keyword' }]
    const block = new FakeCodeBlock({ 'data-tokens': packRanges(ranges) }, 'const')
    const root = new FakeRoot([block])
    const env = rangesEnvironment()

    const disposers = applyHighlighting(root, env)

    expect(disposers).toHaveLength(1)
    expect(block.replacedWith).toBeNull()
    const keywordSet = env.highlights.get(`${BRAND.slug}-tok-keyword`) as FakeHighlightSet
    expect(keywordSet.ranges.size).toBe(1)

    disposers[0]?.()
    expect(keywordSet.ranges.size).toBe(0)
  })

  it('replaces the text node with markup when the Highlight API is missing', () => {
    const ranges: TokenRange[] = [{ start: 0, end: 5, type: 'keyword' }]
    const block = new FakeCodeBlock({ 'data-tokens': packRanges(ranges) }, 'const')
    const root = new FakeRoot([block])
    const env = markupEnvironment()

    const disposers = applyHighlighting(root, env)

    expect(disposers).toHaveLength(0)
    expect(block.replacedWith).toEqual([{ html: '<span class="tok-keyword">const</span>' }])
  })

  it('skips a matched block with no data-tokens attribute', () => {
    const block = new FakeCodeBlock({}, 'const')
    const root = new FakeRoot([block])
    const env = markupEnvironment()

    applyHighlighting(root, env)

    expect(block.replacedWith).toBeNull()
  })

  it('skips a matched block with no text node', () => {
    const block = new FakeCodeBlock({ 'data-tokens': packRanges([]) }, null)
    const root = new FakeRoot([block])
    const env = markupEnvironment()

    const disposers = applyHighlighting(root, env)

    expect(disposers).toHaveLength(0)
    expect(block.replacedWith).toBeNull()
  })

  it('leaves a block with an unreadable data-tokens plain and highlights the rest', () => {
    const broken = new FakeCodeBlock({ 'data-tokens': '1:not,a,range' }, 'const')
    const sound = new FakeCodeBlock(
      { 'data-tokens': packRanges([{ start: 0, end: 5, type: 'keyword' }]) },
      'const',
    )
    const root = new FakeRoot([broken, sound])
    const env = markupEnvironment()

    const disposers = applyHighlighting(root, env)

    expect(disposers).toHaveLength(0)
    expect(broken.replacedWith).toBeNull()
    expect(sound.replacedWith).toEqual([{ html: '<span class="tok-keyword">const</span>' }])
  })

  it('leaves a block packed by a newer writer plain rather than misreading it', () => {
    const future = new FakeCodeBlock({ 'data-tokens': '2:0,5,0' }, 'const')
    const root = new FakeRoot([future])
    const env = rangesEnvironment()

    expect(applyHighlighting(root, env)).toHaveLength(0)
    expect(future.replacedWith).toBeNull()
  })

  it('applies every matched block under root', () => {
    const a = new FakeCodeBlock({ 'data-tokens': packRanges([]) }, 'a')
    const b = new FakeCodeBlock({ 'data-tokens': packRanges([]) }, 'b')
    const root = new FakeRoot([a, b])
    const env = rangesEnvironment()

    const disposers = applyHighlighting(root, env)

    expect(disposers).toHaveLength(2)
  })
})
