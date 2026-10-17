import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorState, Transaction } from '@tiptap/pm/state'

/**
 * Which of the document's links can be shown as an embed (ADR-042, "Embeds are
 * an allowlist").
 *
 * Whether a page may be embedded is a fact about its *preview*: the resolver
 * records a frame only for an allowlisted provider under a `rich` policy. The
 * editor makes no requests of its own, so the application tells it, one link at
 * a time, as previews arrive (`link-embed-sync.tsx`). The actions that offer
 * `Embed` are plain functions of the editor state, as every action is, so what
 * they need to know lives in the state: a small plugin holding the answer per
 * address.
 *
 * It is not part of the document and never enters the undo history. An address
 * the application has not answered for is simply not embeddable yet.
 */

export interface LinkEmbedHint {
  /** What a reader would call the provider: "YouTube". */
  readonly provider: string
  /** Width over height, for the placeholder that holds the embed's place. */
  readonly aspectRatio: number
}

type Hints = ReadonlyMap<string, LinkEmbedHint>

export const linkEmbedsKey = new PluginKey<Hints>('linkEmbeds')

interface HintMeta {
  readonly href: string
  /** Null says the address cannot be embedded (or no longer can). */
  readonly hint: LinkEmbedHint | null
}

function isHintMeta(value: unknown): value is HintMeta {
  return typeof value === 'object' && value !== null && 'href' in value && 'hint' in value
}

/** What is known about an address's embed, or undefined when it cannot be embedded. */
export function embedHintFor(state: EditorState, href: string): LinkEmbedHint | undefined {
  return linkEmbedsKey.getState(state)?.get(href)
}

/**
 * The transaction that records the answer for an address, or null when the state
 * already holds it, so a caller that keeps asking does not keep dispatching.
 */
export function recordLinkEmbed(
  state: EditorState,
  href: string,
  hint: LinkEmbedHint | null,
): Transaction | null {
  const known = embedHintFor(state, href)
  if (known?.provider === hint?.provider && known?.aspectRatio === hint?.aspectRatio) return null
  const meta: HintMeta = { href, hint }
  return state.tr.setMeta(linkEmbedsKey, meta).setMeta('addToHistory', false)
}

export function linkEmbedsPlugin(): Plugin<Hints> {
  return new Plugin<Hints>({
    key: linkEmbedsKey,
    state: {
      init: () => new Map(),
      apply: (transaction, hints) => {
        const meta: unknown = transaction.getMeta(linkEmbedsKey)
        if (!isHintMeta(meta)) return hints
        const next = new Map(hints)
        if (meta.hint === null) next.delete(meta.href)
        else next.set(meta.href, meta.hint)
        return next
      },
    },
  })
}

export const LinkEmbedsExtension = Extension.create({
  name: 'linkEmbeds',
  addProseMirrorPlugins() {
    return [linkEmbedsPlugin()]
  },
})
