import type { Element, Root as HastRoot } from 'hast'
import type { Schema } from 'hast-util-sanitize'
import type { Link, PhrasingContent, Root, Text } from 'mdast'
import { visit } from 'unist-util-visit'

import { rewriteTree } from '../tree.ts'
import type { StandardEmoji } from './shortcodes.ts'

/**
 * Emoji shortcodes (ADR-038): `:+1:` draws 👍 and `:acme:` draws the
 * organisation's own image.
 *
 * One module owns the whole feature — the syntax, the rendering, what the
 * sanitiser admits for it, and the scan the editor draws from — so it can
 * move behind ADR-039's `MarkdownExtension` as it stands. It never imports
 * GitHub's table (`shortcodes.ts`): whoever renders passes a lookup, so the
 * editor can load the table lazily and draw custom emoji before it arrives.
 *
 * **The syntax is a name closed by a colon, and it is plain text.**
 * `remark-directive` refuses a directive whose name is followed by `:`, so
 * `:smile:` reaches the tree as text, never as a directive, and a label with
 * the same name (`:acme[Acme]`) is a different construct: the syntax
 * decides which is which, never the name. Text inside code, inline or
 * fenced, is not text to the tree and is never touched; an autolink's text
 * is its address and is left alone too. A name nobody defines stays literal.
 */

/**
 * A custom emoji's name: the label family's shape (ADR-037) with `_`, which
 * GitHub's own names use (`:globex_logo:` beside `:+1:` and `:1st_place_medal:`).
 * Held to the theme's `EMOJI_NAME_PATTERN` by a test in the server.
 */
export const EMOJI_NAME = /^[a-z][a-z0-9_-]{0,31}$/u

/**
 * Where a custom emoji's image is served: same-origin, named by the emoji
 * and a hash of its bytes, so the address is immutable (ADR-038). The
 * sanitiser admits `img.emoji` only with a `src` of this shape.
 */
export const EMOJI_ASSET_URL =
  /^\/api\/emoji\/[a-z][a-z0-9_-]{0,31}\.[0-9a-f]{16}\.(?:png|jpg|gif|webp|avif|svg)$/u

/** An organisation's own emoji, as the renderer is given it. */
export interface CustomEmoji {
  /** Matches `EMOJI_ASSET_URL`; anything else is drawn as the literal shortcode. */
  readonly src: string
  /**
   * An animation's first frame, drawn instead for a reader who asks for less
   * motion (`prefers-reduced-motion`). Matches `EMOJI_ASSET_URL` too, or is
   * left out.
   */
  readonly still?: string | undefined
  /**
   * An animation's frame count and the length of one loop, recorded at
   * upload, so the reader's enhancer can stop it after a brief play without
   * decoding it (ADR-047). Drawn only beside a still, and only in bounds.
   */
  readonly frames?: number | undefined
  readonly milliseconds?: number | undefined
  /** The image's own size, which gives its proportions; it is drawn at text size. */
  readonly width: number
  readonly height: number
}

export type ResolvedEmoji =
  | { readonly kind: 'custom'; readonly name: string; readonly image: CustomEmoji }
  | ({ readonly kind: 'standard'; readonly name: string } & StandardEmoji)

/** Looks a shortcode's name up; undefined when nothing by that name exists. */
export type EmojiLookup = (name: string) => ResolvedEmoji | undefined

/** GitHub's table, as `shortcodes.ts` publishes it. */
export type StandardLookup = (name: string) => StandardEmoji | undefined

/**
 * The emoji a name draws. An organisation's own emoji wins where its name is
 * also one of GitHub's — the tenant chose it — and nowhere else; a custom
 * image whose address is not one this server serves is not drawn at all.
 */
export function emojiLookup(
  custom: ReadonlyMap<string, CustomEmoji>,
  standard: StandardLookup,
): EmojiLookup {
  return (name) => {
    const image = custom.get(name)
    if (image !== undefined && EMOJI_NAME.test(name) && EMOJI_ASSET_URL.test(image.src)) {
      const { still, ...picture } = image
      const servedStill = still !== undefined && EMOJI_ASSET_URL.test(still) ? { still } : {}
      return { kind: 'custom', name, image: { ...picture, ...servedStill } }
    }
    const found = standard(name)
    return found === undefined ? undefined : { kind: 'standard', name, ...found }
  }
}

export interface ShortcodeMatch {
  /** Offsets into the text: the opening colon, and just past the closing one. */
  readonly start: number
  readonly end: number
  readonly emoji: ResolvedEmoji
}

/**
 * A name between colons. The lookahead leaves the closing colon unconsumed,
 * so in `:note:smile:` an unknown `note` does not swallow the colon that
 * opens `:smile:`.
 */
const SHORTCODE = /:([a-z0-9_+-]+)(?=:)/gu

/**
 * Every shortcode in a run of text that names an emoji, in order. Lazy, so
 * the editor can stop early, and used by the renderer and the editor alike,
 * so a shortcode is found the same way while it is written as when it is read.
 */
export function* findShortcodes(text: string, lookup: EmojiLookup): Generator<ShortcodeMatch> {
  if (!text.includes(':')) return
  const pattern = new RegExp(SHORTCODE)
  for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
    const emoji = lookup(String(match[1]))
    if (emoji === undefined) continue
    const end = match.index + match[0].length + 1
    pattern.lastIndex = end
    yield { start: match.index, end, emoji }
  }
}

/** The height every custom image is declared at, before the stylesheet sets it to the text's. */
const DECLARED_SIZE = 20

/** The media query an animation's still is drawn under. */
export const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

/**
 * The attributes an animated emoji's `picture` carries its timing in
 * (ADR-047): its frame count and one loop's length in milliseconds. The
 * sanitiser admits each only as an integer within the upload limits
 * (`FRAME_COUNT`, `LOOP_MILLISECONDS`).
 */
export const EMOJI_FRAMES_ATTRIBUTE = 'data-frames'
export const EMOJI_LOOP_ATTRIBUTE = 'data-loop-ms'

/** 2 to 300: an animation has two frames at least, and an emoji 300 at most. */
const FRAME_COUNT = /^(?:[2-9]|[1-9]\d|[12]\d\d|300)$/u
/** 1 to 10,000: an emoji runs for ten seconds at most. */
const LOOP_MILLISECONDS = /^(?:[1-9]\d{0,3}|10000)$/u

/** An animation's timing as its picture's attributes, each only when it is in bounds. */
function timingAttributes(image: CustomEmoji): Record<string, string> {
  const frames = String(image.frames)
  const milliseconds = String(image.milliseconds)
  return {
    ...(FRAME_COUNT.test(frames) ? { [EMOJI_FRAMES_ATTRIBUTE]: frames } : {}),
    ...(LOOP_MILLISECONDS.test(milliseconds) ? { [EMOJI_LOOP_ATTRIBUTE]: milliseconds } : {}),
  }
}

/** An emoji's markup as plain attributes, which the renderer and the editor both build from. */
export interface EmojiMarkup {
  readonly tagName: 'span' | 'img'
  readonly attributes: Readonly<Record<string, string>>
  /** The character a standard emoji is; empty for an image. */
  readonly text: string
  /**
   * An animation's still, and its `picture`'s own attributes beside its
   * class: the timing the reader's enhancer plays it by (ADR-047). When
   * present the image is drawn inside a `<picture class="emoji">` whose
   * `<source>` offers the still under `REDUCED_MOTION`, so the browser
   * chooses, with no script and no flash.
   */
  readonly animation?: {
    readonly still: string
    readonly attributes: Readonly<Record<string, string>>
  }
}

/**
 * How an emoji is drawn. In running text it means something, so it is named:
 * a standard emoji by its description (`role="img"`), a custom one by its
 * shortcode as alternative text, which is what a reader sees if the image
 * cannot load. Leading a label's pill it is decoration, because the label's
 * own words already say what it is.
 */
export function emojiMarkup(emoji: ResolvedEmoji, use: 'text' | 'decoration'): EmojiMarkup {
  const meaning = use === 'text'
  if (emoji.kind === 'standard') {
    const attributes = meaning
      ? { class: 'emoji', role: 'img', 'aria-label': emoji.description }
      : { class: 'emoji', 'aria-hidden': 'true' }
    return { tagName: 'span', attributes, text: emoji.character }
  }
  const { image } = emoji
  const shortcode = `:${emoji.name}:`
  const width = Math.max(1, Math.round((DECLARED_SIZE * image.width) / image.height))
  return {
    tagName: 'img',
    attributes: {
      class: 'emoji',
      src: image.src,
      alt: meaning ? shortcode : '',
      ...(meaning ? { title: shortcode } : {}),
      width: String(width),
      height: String(DECLARED_SIZE),
    },
    text: '',
    ...(image.still === undefined
      ? {}
      : { animation: { still: image.still, attributes: timingAttributes(image) } }),
  }
}

/** The same markup as a hast element, for the renderer. */
export function emojiElement(emoji: ResolvedEmoji, use: 'text' | 'decoration'): Element {
  const { tagName, attributes, text, animation } = emojiMarkup(emoji, use)
  const { class: className, ...rest } = attributes
  const drawn: Element = {
    type: 'element',
    tagName,
    properties: { className: [String(className)], ...rest },
    children: text === '' ? [] : [{ type: 'text', value: text }],
  }
  if (animation === undefined) return drawn
  return {
    type: 'element',
    tagName: 'picture',
    properties: { className: ['emoji'], ...animation.attributes },
    children: [
      {
        type: 'element',
        tagName: 'source',
        properties: { srcSet: animation.still, media: REDUCED_MOTION },
        children: [],
      },
      drawn,
    ],
  }
}

/**
 * One text node split into text and emoji. An emoji stays a text node whose
 * value is still its shortcode — so the outline, a heading's slug and
 * anything else that reads the tree's text read what the author wrote — and
 * carries the element it is drawn as in `data`, which is how mdast-util-to-hast
 * is told to draw a node as something else.
 */
function splitText(node: Text, lookup: EmojiLookup): Text[] {
  const pieces: Text[] = []
  let from = 0
  for (const { start, end, emoji } of findShortcodes(node.value, lookup)) {
    if (start > from) pieces.push({ type: 'text', value: node.value.slice(from, start) })
    const drawn = emojiElement(emoji, 'text')
    pieces.push({
      type: 'text',
      value: node.value.slice(start, end),
      data: { hName: drawn.tagName, hProperties: drawn.properties, hChildren: drawn.children },
    })
    from = end
  }
  if (from === 0) return [node]
  if (from < node.value.length) pieces.push({ type: 'text', value: node.value.slice(from) })
  return pieces
}

/** A link whose text is its own address, which shortcodes must not be read out of. */
function isAutolink(link: Link): boolean {
  const [only] = link.children
  return link.children.length === 1 && only?.type === 'text' && link.url.endsWith(only.value)
}

/**
 * The tree with every known shortcode drawn as its emoji. Pure: the tree it
 * is given is not changed. A tree with no colon in its text is returned as
 * it came, after one walk.
 */
export function withEmoji(tree: Root, lookup: EmojiLookup): Root {
  return rewriteTree(tree, (node, parentType) => {
    if (node.type === 'text') return parentType === 'link' ? undefined : splitText(node, lookup)
    if (node.type !== 'link' || isAutolink(node)) return undefined
    const children = node.children.flatMap((child): PhrasingContent[] =>
      child.type === 'text' ? splitText(child, lookup) : [child],
    )
    return [{ ...node, children }]
  })
}

/**
 * What the sanitiser admits for emoji, in `hast-util-sanitize`'s terms — the
 * grant ADR-039 asks every extension to declare. A standard emoji is a span
 * named as an image or hidden as decoration; a custom one is an image whose
 * size is a number and whose `src` is held to `EMOJI_ASSET_URL` by
 * `guardEmojiImages`, because the schema cannot tie one attribute's value to
 * another's. An animated one is that image inside a `picture`, whose one
 * `source` is held to an emoji's address and the reduced-motion query, and
 * whose timing attributes are held to bounded integers.
 */
export const EMOJI_SANITIZE_GRANT: {
  readonly classes: {
    readonly span: readonly string[]
    readonly img: readonly string[]
    readonly picture: readonly string[]
  }
  readonly attributes: {
    readonly span: NonNullable<Schema['attributes']>[string]
    readonly picture: NonNullable<Schema['attributes']>[string]
    readonly source: NonNullable<Schema['attributes']>[string]
  }
} = {
  classes: { span: ['emoji'], img: ['emoji'], picture: ['emoji'] },
  attributes: {
    span: [['role', 'img'], 'aria-label', ['aria-hidden', 'true']],
    // An animation's timing, only as integers within the upload limits.
    picture: [
      [EMOJI_FRAMES_ATTRIBUTE, FRAME_COUNT],
      [EMOJI_LOOP_ATTRIBUTE, LOOP_MILLISECONDS],
    ],
    // An animation's still: only an emoji's address, only under reduced motion.
    source: [
      ['srcSet', EMOJI_ASSET_URL],
      ['media', REDUCED_MOTION],
    ],
  },
}

function hasClass(node: Element, name: string): boolean {
  const classes = node.properties['className']
  return Array.isArray(classes) && classes.includes(name)
}

/**
 * Takes the `emoji` class off any image whose address is not an emoji's, after
 * the sanitiser has run. Only the renderer ever emits the class — an author's
 * raw HTML was escaped to text long before — so this changes nothing today;
 * it is what keeps "an emoji is an image this server serves" true if that
 * ever stops being so.
 */
export function guardEmojiImages(tree: HastRoot): HastRoot {
  visit(tree, 'element', (node: Element) => {
    if (node.tagName !== 'img' || !hasClass(node, 'emoji')) return
    if (EMOJI_ASSET_URL.test(String(node.properties['src']))) return
    delete node.properties['className']
  })
  return tree
}
