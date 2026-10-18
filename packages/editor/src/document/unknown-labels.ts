import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

import { unknownLabelWarning } from '@quill/markdown'

import { redecorateChangedBlocks } from './changed-blocks.ts'

/**
 * The editor's warning about a label that is not one (ADR-037).
 *
 * `:acm[Acme]` renders as written, because a directive nobody defines
 * degrades to its source (ADR-002); this is how the author notices the typo
 * before a reader does. The directive is underlined and the reason is put
 * beside it in words for assistive technology — never the underline alone —
 * with the nearest label offered when one is near. A decoration, like the
 * required-section marker, so nothing is written into the document.
 *
 * The set lives in plugin state and is mapped through each transaction, with
 * only the blocks the transaction touched looked at again: a keystroke in a
 * long document costs its own paragraph, not the document (quill-plan.md
 * section 31).
 */

export const UNKNOWN_LABELS = 'unknownLabels'

function reason(warning: string): HTMLElement {
  const element = document.createElement('span')
  element.className = 'sr-only'
  element.textContent = ` (${warning})`
  return element
}

/** The warnings for the labels between two positions. */
function labelWarnings(
  doc: PMNode,
  from: number,
  to: number,
  labels: ReadonlySet<string>,
): readonly Decoration[] {
  const decorations: Decoration[] = []
  doc.nodesBetween(from, to, (node, position) => {
    if (node.type.name !== 'textDirective') return true
    const warning = unknownLabelWarning(String(node.attrs['name']), node.textContent, labels)
    if (warning === undefined) return false
    const end = position + node.nodeSize
    decorations.push(
      Decoration.node(position, end, { 'data-unknown-label': 'true', title: warning }, { warning }),
      // Keyed by its words, so a block drawn again keeps the element rather
      // than swapping it for an equal one on every keystroke (section 31).
      Decoration.widget(end, () => reason(warning), { side: 1, key: `unknown-label:${warning}` }),
    )
    return false
  })
  return decorations
}

// Decorations are a pure function of the document and the labels, so the
// same document never pays for them twice.
const cache = new WeakMap<ReadonlySet<string>, WeakMap<PMNode, DecorationSet>>()

/** Every warning in a document, which is what the plugin starts from. */
export function unknownLabelDecorations(doc: PMNode, labels: ReadonlySet<string>): DecorationSet {
  const byDocument = cache.get(labels) ?? new WeakMap<PMNode, DecorationSet>()
  cache.set(labels, byDocument)
  const cached = byDocument.get(doc)
  if (cached !== undefined) return cached
  const set = DecorationSet.create(doc, [...labelWarnings(doc, 0, doc.content.size, labels)])
  byDocument.set(doc, set)
  return set
}

export const unknownLabelsKey = new PluginKey<DecorationSet>(UNKNOWN_LABELS)

/** Warns about unknown labels, against the organisation's label names. */
export function unknownLabels(names: readonly string[]): Extension {
  const labels: ReadonlySet<string> = new Set(names)
  return Extension.create({
    name: UNKNOWN_LABELS,
    addProseMirrorPlugins: () => [
      new Plugin<DecorationSet>({
        key: unknownLabelsKey,
        state: {
          init: (_, state) => unknownLabelDecorations(state.doc, labels),
          apply: (transaction, set) =>
            redecorateChangedBlocks(set, transaction, (doc, from, to) =>
              labelWarnings(doc, from, to, labels),
            ),
        },
        props: { decorations: (state) => unknownLabelsKey.getState(state) },
      }),
    ],
  })
}
