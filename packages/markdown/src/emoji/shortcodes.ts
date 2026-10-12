import { SHORTCODE_TABLE } from './shortcodes.gen.ts'

/**
 * GitHub's emoji shortcodes, `:+1:` to `:zzz:` with every alias (ADR-038).
 *
 * Kept apart from `emoji.ts`, which never imports it: the table is about 60 KB
 * of text, and the editor loads it with a dynamic import only once a document
 * is open, so no reading route and no first paint pays for it. The renderer,
 * on the server, imports it directly.
 */

/** A standard emoji: the character, and the description that names it to a screen reader. */
export interface StandardEmoji {
  readonly character: string
  readonly description: string
}

let table: ReadonlyMap<string, StandardEmoji> | undefined

/**
 * Read once, on first use, rather than at import: a module that builds a map
 * when it loads is a side effect no bundler may drop, and most code that
 * imports this package never asks for an emoji.
 */
function shortcodeTable(): ReadonlyMap<string, StandardEmoji> {
  table ??= new Map(
    SHORTCODE_TABLE.split('\n').flatMap((line) => {
      const [character = '', description = '', names = ''] = line.split('\t')
      return names.split(' ').map((name) => [name, { character, description }] as const)
    }),
  )
  return table
}

/** The standard emoji a shortcode names (`+1`, `tada`), or undefined when GitHub has none. */
export function standardEmoji(name: string): StandardEmoji | undefined {
  return shortcodeTable().get(name)
}

/** A standard emoji with every name it answers to, for a picker to search. */
export interface NamedStandardEmoji extends StandardEmoji {
  readonly names: readonly string[]
}

let listed: readonly NamedStandardEmoji[] | undefined

/** Every standard emoji once, in GitHub's order, with its names. */
export function standardEmojiList(): readonly NamedStandardEmoji[] {
  listed ??= SHORTCODE_TABLE.split('\n').map((line) => {
    const [character = '', description = '', names = ''] = line.split('\t')
    return { character, description, names: names.split(' ') }
  })
  return listed
}
