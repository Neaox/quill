import { enhanceAnimatedImages } from '@quill/design-css/animated-images'
import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

import {
  emojiLookup,
  emojiMarkup,
  REDUCED_MOTION,
  findShortcodes,
  isLabelDirective,
  type CustomEmoji,
  type EmojiMarkup,
  type EmojiLookup,
  type ResolvedEmoji,
  type StandardLookup,
} from '@quill/markdown'

import { changedBlocks } from './changed-blocks.ts'

/**
 * Emoji while writing (ADR-038): `:+1:` and `:acme:` are drawn as the
 * reader draws them, and the Markdown keeps the shortcode.
 *
 * Decorations, like the unknown-label warning, so nothing is written into
 * the document: the shortcode's text is still there, hidden behind the
 * emoji, and comes back into view while the selection touches it, so it can
 * be edited as the text it is. A label that leads with an emoji has it drawn
 * inside its pill. Shortcodes are found by the same scan the renderer uses
 * (`findShortcodes`) and drawn from the same markup (`emojiMarkup`), so an
 * emoji looks the same while it is written as when it is read.
 *
 * An animated emoji follows the reader's rules (ADR-047): it plays briefly
 * when first seen and rests on its still, replays on hover, and honours the
 * person's setting and reduced motion, through the reader's own enhancer, so
 * writing next to one is not distracting.
 *
 * GitHub's table is loaded lazily, once, the first time an editor opens: no
 * reading route pays for it, and custom emoji are drawn before it arrives.
 *
 * The scan is kept per document and brought forward through each transaction:
 * what was found outside the blocks a transaction touched is mapped, and only
 * those blocks are scanned again, so a keystroke in a long document costs its
 * own paragraph (quill-plan.md section 31).
 */

export const EMOJI_SHORTCODES = 'emojiShortcodes'

export interface EditorEmojiOptions {
  /** The organisation's own emoji by name. */
  readonly custom: ReadonlyMap<string, CustomEmoji>
  /** The emoji each label's pill leads with, by label name. */
  readonly labelEmoji: ReadonlyMap<string, string>
}

let standardTable: Promise<StandardLookup> | undefined

/** GitHub's table, imported once per page however many editors open. */
export function loadStandardEmoji(): Promise<StandardLookup> {
  standardTable ??= import('@quill/markdown/emoji-shortcodes').then(
    (module) => module.standardEmoji,
  )
  return standardTable
}

const noStandard: StandardLookup = () => undefined

/** One emoji to draw: over a shortcode's text, or at the start of a label's pill. */
interface Found {
  readonly from: number
  readonly to: number
  readonly emoji: ResolvedEmoji
}

function isAutolinkText(node: PMNode): boolean {
  const link = node.marks.find((mark) => mark.type.name === 'link')
  return link !== undefined && String(link.attrs['href']).endsWith(node.textContent)
}

/** Every emoji in a document, or between two of its positions. */
export function findEmoji(
  doc: PMNode,
  lookup: EmojiLookup,
  labelEmoji: ReadonlyMap<string, string>,
  from = 0,
  to: number = doc.content.size,
): readonly Found[] {
  const labels = new Set(labelEmoji.keys())
  const found: Found[] = []
  doc.nodesBetween(from, to, (node, position) => {
    if (node.type.spec.code === true) return false
    if (node.type.name === 'textDirective') {
      const name = String(node.attrs['name'])
      const lead = labelEmoji.get(name)
      const emoji = lead === undefined ? undefined : lookup(lead)
      if (emoji !== undefined && isLabelDirective(name, labels) && node.textContent.trim() !== '') {
        found.push({ from: position + 1, to: position + 1, emoji })
      }
      return true
    }
    if (!node.isText) return true
    if (node.marks.some((mark) => mark.type.name === 'code') || isAutolinkText(node)) return false
    for (const match of findShortcodes(node.textContent, lookup)) {
      found.push({ from: position + match.start, to: position + match.end, emoji: match.emoji })
    }
    return false
  })
  return found
}

/**
 * What was found before a transaction, brought forward through it: mapped
 * where the document did not change, and scanned again where it did.
 */
function rescanChanged(
  found: readonly Found[],
  transaction: Transaction,
  scan: (doc: PMNode, from: number, to: number) => readonly Found[],
): readonly Found[] {
  const changed = changedBlocks(transaction)
  const { doc, mapping } = transaction
  const kept = found
    .map((item) => ({ ...item, from: mapping.map(item.from), to: mapping.map(item.to) }))
    .filter((item) => !changed.some((range) => item.from >= range.from && item.to <= range.to))
  const rescanned = changed.flatMap((range) => scan(doc, range.from, range.to))
  return [...kept, ...rescanned].toSorted((a, b) => a.from - b.from)
}

/**
 * The renderer's markup, as DOM: an animation inside the same `picture` the
 * reader gets (`emojiElement`), so its still shows under reduced motion here too.
 */
function toDom({ tagName, attributes, text, animation }: EmojiMarkup): HTMLElement {
  const dom = document.createElement(tagName)
  for (const [name, value] of Object.entries(attributes)) dom.setAttribute(name, value)
  dom.textContent = text
  if (animation === undefined) return dom
  const picture = document.createElement('picture')
  picture.className = 'emoji'
  for (const [name, value] of Object.entries(animation.attributes))
    picture.setAttribute(name, value)
  const source = document.createElement('source')
  source.srcset = animation.still
  source.media = REDUCED_MOTION
  picture.append(source, dom)
  return picture
}

/**
 * The decorations for a state: each emoji drawn, and its shortcode hidden,
 * except where the selection touches it.
 */
export function emojiDecorations(state: EditorState, found: readonly Found[]): DecorationSet {
  const { from, to } = state.selection
  const decorations = found.flatMap(({ from: start, to: end, emoji }) => {
    if (start === end) {
      return [
        Decoration.widget(start, () => toDom(emojiMarkup(emoji, 'decoration')), {
          side: -1,
          key: `lead:${emoji.name}`,
        }),
      ]
    }
    if (from <= end && to >= start) return []
    return [
      Decoration.widget(start, () => toDom(emojiMarkup(emoji, 'text')), {
        side: -1,
        key: `emoji:${emoji.name}`,
      }),
      Decoration.inline(start, end, { class: 'emoji-source' }),
    ]
  })
  return DecorationSet.create(state.doc, decorations)
}

/** The emoji plugin's key, whose state is what is drawn. */
export const emojiShortcodesKey = new PluginKey<DecorationSet>(EMOJI_SHORTCODES)

/** Draws emoji in the editor, from the organisation's own and, once loaded, GitHub's. */
export function emojiShortcodes(options: EditorEmojiOptions): Extension {
  const key = emojiShortcodesKey
  let lookup = emojiLookup(options.custom, noStandard)
  let scanned = new WeakMap<PMNode, readonly Found[]>()

  const scan = (doc: PMNode, from?: number, to?: number): readonly Found[] =>
    findEmoji(doc, lookup, options.labelEmoji, from, to)

  // Found once per document: a document reached by a transaction is found
  // from its predecessor's scan, any other (the first, or one after GitHub's
  // table arrives) by scanning it whole.
  const foundIn = (doc: PMNode, previous?: { doc: PMNode; transaction: Transaction }) => {
    const known = scanned.get(doc)
    if (known !== undefined) return known
    const before = previous === undefined ? undefined : scanned.get(previous.doc)
    const found =
      previous === undefined || before === undefined
        ? scan(doc)
        : rescanChanged(before, previous.transaction, scan)
    scanned.set(doc, found)
    return found
  }

  return Extension.create({
    name: EMOJI_SHORTCODES,
    addProseMirrorPlugins: () => [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: (_, state) => emojiDecorations(state, foundIn(state.doc)),
          apply: (transaction, previous, before, state) =>
            transaction.docChanged ||
            transaction.selectionSet ||
            transaction.getMeta(key) !== undefined
              ? emojiDecorations(state, foundIn(state.doc, { doc: before.doc, transaction }))
              : previous,
        },
        props: { decorations: (state) => key.getState(state) },
        view: (view) => {
          let open = true
          // Animated emoji play briefly and rest, as the reader's do (ADR-047).
          const stopAnimating = enhanceAnimatedImages(view.dom)
          void loadStandardEmoji().then((standard) => {
            if (!open) return
            lookup = emojiLookup(options.custom, standard)
            scanned = new WeakMap()
            view.dispatch(view.state.tr.setMeta(key, 'standard'))
          })
          return {
            destroy: () => {
              open = false
              stopAnimating()
            },
          }
        },
      }),
    ],
  })
}
