/**
 * The client entry point (ADR-030): one pass over `root` after hydration,
 * per page. For each `pre > code[data-tokens]` block it unpacks the server's
 * ranges and either paints them through the CSS Custom Highlight API over
 * the block's single text node, or — where that API is missing — replaces
 * the text node once with `toMarkup` spans.
 *
 * Every DOM-touching capability arrives through `env`, so this module never
 * reaches for the real `window`/`document` itself; a consumer (apps/web)
 * supplies a real environment once, and tests supply small fakes. A real
 * `createRange` typically builds a `StaticRange` over the text node (falling
 * back to `document.createRange()` where `StaticRange` is unavailable); a
 * real `parseMarkup` typically sets the HTML on a detached `<template>` and
 * returns its content's child nodes.
 */
import { unpackRanges } from '../pack.ts'
import { toMarkup } from '../markup.ts'
import type { TokenRange } from '../tokens.ts'
import {
  createTokenHighlightRegistry,
  type HighlightRegistryLike,
  type HighlightSetLike,
  type TokenHighlightRegistry,
} from './highlight-registry.ts'

export interface TextNodeLike {
  readonly data: string
}

export interface CodeBlockElement {
  getAttribute(name: string): string | null
  readonly childNodes: ArrayLike<TextNodeLike>
  replaceChildren(...nodes: unknown[]): void
}

export interface HighlightRoot {
  querySelectorAll(selector: string): Iterable<CodeBlockElement>
}

export interface HighlightClientEnvironment {
  readonly CSS?: { readonly highlights?: HighlightRegistryLike }
  readonly Highlight?: new () => HighlightSetLike
  /** Builds the opaque range object `createTokenHighlightRegistry` adds to a `Highlight`. */
  createRange(node: TextNodeLike, start: number, end: number): unknown
  /** Builds the replacement nodes for the no-`CSS.highlights` fallback. */
  parseMarkup(html: string): unknown[]
}

const CODE_BLOCK_SELECTOR = 'pre > code[data-tokens]'

/**
 * One block's ranges, or null when its attribute cannot be read.
 *
 * `unpackRanges` throws on a payload it does not recognise, and a page is a
 * whole document's worth of blocks: one truncated or stale attribute must cost
 * that block its colour and nothing else, so the failure is contained here
 * rather than abandoning every block after it. A block left plain is already
 * the documented outcome for a language no grammar covers (ADR-030).
 */
function rangesOf(packed: string): readonly TokenRange[] | null {
  try {
    return unpackRanges(packed)
  } catch {
    return null
  }
}

/**
 * Equivalent to `supportsHighlightRanges(env)`, restated here so the
 * `if` narrows `CSS`/`Highlight` to non-nullable for the construction below
 * — a call to the standalone predicate does not survive as a narrowing fact
 * across the call boundary.
 */
function createRangesRegistry(env: HighlightClientEnvironment): TokenHighlightRegistry | null {
  const { CSS, Highlight } = env
  if (CSS?.highlights == null || Highlight == null) return null
  return createTokenHighlightRegistry({
    highlights: CSS.highlights,
    createHighlightSet: () => new Highlight(),
  })
}

/**
 * Applies every highlighted code block under `root`, returning one disposer
 * per block that was painted through the ranges backend (an empty array
 * under the markup fallback, which mutates the DOM once and needs no later
 * cleanup).
 */
export function applyHighlighting(
  root: HighlightRoot,
  env: HighlightClientEnvironment,
): Array<() => void> {
  const registry = createRangesRegistry(env)
  const disposers: Array<() => void> = []

  for (const codeBlock of root.querySelectorAll(CODE_BLOCK_SELECTOR)) {
    const packed = codeBlock.getAttribute('data-tokens')
    if (packed === null) continue
    const textNode = codeBlock.childNodes[0]
    if (textNode === undefined) continue

    const ranges = rangesOf(packed)
    if (ranges === null) continue
    if (registry !== null) {
      const dispose = registry.applyRanges(
        (range) => env.createRange(textNode, range.start, range.end),
        ranges,
      )
      disposers.push(dispose)
    } else {
      codeBlock.replaceChildren(...env.parseMarkup(toMarkup(textNode.data, ranges)))
    }
  }

  return disposers
}
