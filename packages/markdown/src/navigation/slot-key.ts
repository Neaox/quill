/**
 * A child pages slot's key and the options it names (ADR-049), apart from
 * the directive so a reader can read a slot without the Markdown pipeline:
 * this module imports nothing, and is what `@quill/markdown/child-pages-slot`
 * gives the web app's reading bundle.
 */

/** The live-block type the slot carries in `data-live-block`. */
export const CHILD_PAGES_BLOCK = 'children'

export const CHILD_PAGES_DEPTHS = [1, 2, 3, 4, 5, 6] as const

export type ChildPagesDepth = (typeof CHILD_PAGES_DEPTHS)[number]

export const CHILD_PAGES_SORTS = ['manual', 'title', 'updated'] as const

export type ChildPagesSort = (typeof CHILD_PAGES_SORTS)[number]

/** What decides the list: everything but the title. */
export interface ChildPagesQuery {
  readonly depth: ChildPagesDepth
  readonly sort: ChildPagesSort
  readonly excerpts: boolean
  readonly icons: boolean
}

export function isChildPagesSort(value: unknown): value is ChildPagesSort {
  return typeof value === 'string' && (CHILD_PAGES_SORTS as readonly string[]).includes(value)
}

/** A depth written as a whole number from 1 to 6; undefined otherwise. */
export function parseChildPagesDepth(value: string): ChildPagesDepth | undefined {
  if (!/^\d$/.test(value)) return undefined
  const depth = Number(value)
  return CHILD_PAGES_DEPTHS.find((candidate) => candidate === depth)
}

/**
 * The slot's key (ADR-032): the block type and the options that decide the
 * list, in a fixed order, so two blocks asking the same question share it.
 * The title does not decide the list and is not part of it.
 */
export function childPagesSlotKey(query: ChildPagesQuery): string {
  return [
    `${CHILD_PAGES_BLOCK}?depth=${String(query.depth)}&sort=${query.sort}`,
    ...(query.excerpts ? ['excerpts'] : []),
    ...(query.icons ? ['icons'] : []),
  ].join('&')
}

const SLOT_KEY = /^children\?depth=(\d)&sort=([a-z]+)(&excerpts)?(&icons)?$/

/** The options a slot key names, or undefined when it names none. */
export function parseChildPagesSlotKey(key: string): ChildPagesQuery | undefined {
  const match = SLOT_KEY.exec(key)
  if (match === null) return undefined
  const depth = parseChildPagesDepth(String(match[1]))
  const sort = match[2]
  if (depth === undefined || !isChildPagesSort(sort)) return undefined
  return { depth, sort, excerpts: match[3] !== undefined, icons: match[4] !== undefined }
}

/** Exactly the keys a slot can carry, for the sanitiser's grant. */
export const CHILD_PAGES_SLOT_KEY = new RegExp(
  String.raw`^children\?depth=[1-6]&sort=(?:${CHILD_PAGES_SORTS.join('|')})(?:&excerpts)?(?:&icons)?$`,
)

/** The options a bare `::children` asks for. */
export const DEFAULT_CHILD_PAGES_QUERY: ChildPagesQuery = {
  depth: 1,
  sort: 'manual',
  excerpts: false,
  icons: false,
}
