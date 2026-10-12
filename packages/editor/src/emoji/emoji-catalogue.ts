import { describeEmoji, emojiLookup } from '@quill/markdown'
import type { CustomEmoji } from '@quill/markdown'
import type { NamedStandardEmoji } from '@quill/markdown/emoji-shortcodes'

/**
 * Every emoji an author can choose from while writing, as one list (ADR-038).
 *
 * The `/emoji` picker and the `:` suggestion offer the same emoji, so both read
 * this: the organisation's own first, then GitHub's, each with what it is called,
 * what it is, and how to draw it. It follows the renderer's rules, not its own:
 * a custom name wins over a GitHub one where they collide, and a custom image
 * this server does not serve is not offered because it would not be drawn.
 */

/** How an emoji is drawn: a standard emoji by its character, a custom one by its picture. */
export type EmojiPicture = { readonly glyph: string } | { readonly image: string }

export type EmojiEntry = EmojiPicture & {
  /** The shortcode written between colons: the first of its names. */
  readonly name: string
  /** Every name it answers to, `name` first. */
  readonly names: readonly string[]
  /** What it is, in words: the alternative text a reader is given for it. */
  readonly description: string
}

const noStandard = () => undefined

/** The organisation's emoji the renderer would draw, as entries. */
function customEntries(custom: ReadonlyMap<string, CustomEmoji>): readonly EmojiEntry[] {
  const lookup = emojiLookup(custom, noStandard)
  return [...custom.keys()].flatMap((name) => {
    const emoji = lookup(name)
    return emoji?.kind === 'custom'
      ? [{ name, names: [name], description: describeEmoji(emoji), image: emoji.image.src }]
      : []
  })
}

let standardList: Promise<readonly NamedStandardEmoji[]> | undefined

/** GitHub's list, loaded once per page: it is its own chunk and no reader pays for it. */
function loadStandardList(): Promise<readonly NamedStandardEmoji[]> {
  standardList ??= import('@quill/markdown/emoji-shortcodes').then((module) =>
    module.standardEmojiList(),
  )
  return standardList
}

/** The organisation's emoji, then GitHub's, minus any GitHub name a custom emoji has taken. */
export async function emojiCatalogue(
  custom: ReadonlyMap<string, CustomEmoji>,
): Promise<readonly EmojiEntry[]> {
  const standard = (await loadStandardList()).flatMap(({ character, description, names }) => {
    const free = names.filter((name) => !custom.has(name))
    const [name] = free
    return name === undefined ? [] : [{ name, names: free, description, glyph: character }]
  })
  return [...customEntries(custom), ...standard]
}
