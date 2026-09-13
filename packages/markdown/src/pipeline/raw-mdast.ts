import type { Literal } from 'mdast'
import type { Data } from 'unified'

/** The `toMarkdown` extension shape, taken from the processor rather than re-declared. */
export type ToMarkdownExtension = NonNullable<Data['toMarkdownExtensions']>[number]

/**
 * The escape hatch of ADR-002 and research R3 finding 4(c): a node that carries
 * Markdown this package does not model and emits it back unchanged. Nothing in
 * the pipeline may throw on input it does not recognise, so every unmodelled
 * construct ends up here rather than in an exception.
 *
 * Reserved for genuine verbatim *source* — the bytes an author wrote, carried
 * through a round trip untouched. It is not a general degradation: a value put
 * here is written with no escaping at all, so text that happens to look like
 * Markdown would come back as structure. `replaceUnserialisable`
 * (./serialisable.ts) degrades to an escaped text node for that reason.
 */
export interface RawMdast extends Literal {
  type: 'rawMdast'
}

declare module 'mdast' {
  interface RootContentMap {
    rawMdast: RawMdast
  }
  interface BlockContentMap {
    rawMdast: RawMdast
  }
  interface PhrasingContentMap {
    rawMdast: RawMdast
  }
}

export function rawMdast(value: string): RawMdast {
  return { type: 'rawMdast', value }
}

export function isRawMdast(node: { readonly type: string }): node is RawMdast {
  return node.type === 'rawMdast'
}

/** Emits a `rawMdast` node verbatim, with no escaping of any kind. */
export const rawMdastToMarkdown: ToMarkdownExtension = {
  handlers: { rawMdast: (node: RawMdast) => node.value },
}
