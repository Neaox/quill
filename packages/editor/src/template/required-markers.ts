import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

import { redecorateChangedBlocks } from '../document/changed-blocks.ts'
import { templateDeclaration } from './progress.ts'

/**
 * The marker beside a required section's heading (ADR-029).
 *
 * Required is indicated, never enforced: the marker says a section is expected,
 * the template panel says which are still placeholders, and publishing goes
 * ahead either way. It is a decoration rather than a node so it is not part of
 * the document — a heading in a document made from a template is an ordinary
 * heading, and stays one if the author renames it.
 *
 * The meaning is carried by words as well as by a dot, because nothing may be
 * carried by colour or shape alone.
 *
 * The markers live in plugin state and are mapped through each transaction;
 * only the blocks a transaction touched are looked at again, and the whole
 * document only when the front matter that declares the sections changed
 * (quill-plan.md section 31).
 */

function marker(): HTMLElement {
  const element = document.createElement('span')
  element.className = 'required-section-marker'
  const label = document.createElement('span')
  label.className = 'sr-only'
  label.textContent = ' (required section)'
  const dot = document.createElement('span')
  dot.setAttribute('aria-hidden', 'true')
  dot.textContent = '•'
  element.append(label, dot)
  return element
}

// Read from the front matter block, so a keystroke in the body never parses
// the YAML again.
const declared = new WeakMap<PMNode, ReadonlySet<string>>()

/** The headings a template declares as required, read from the document itself. */
export function requiredHeadings(doc: PMNode): ReadonlySet<string> {
  const first = doc.firstChild
  if (first === null || first.type.name !== 'frontMatter') return new Set()
  const known = declared.get(first)
  if (known !== undefined) return known
  const declaration = templateDeclaration(String(first.attrs['value']))
  const required: ReadonlySet<string> = new Set(
    (declaration?.sections ?? [])
      .filter((section) => section.required === true)
      .map((section) => section.heading),
  )
  declared.set(first, required)
  return required
}

/** The markers for the required headings between two positions. */
function markers(doc: PMNode, from: number, to: number): readonly Decoration[] {
  const required = requiredHeadings(doc)
  const decorations: Decoration[] = []
  if (required.size === 0) return decorations
  doc.nodesBetween(from, to, (node, offset) => {
    if (node.type.name === 'heading' && required.has(node.textContent.trim())) {
      decorations.push(
        Decoration.node(offset, offset + node.nodeSize, { 'data-required-section': 'true' }),
        Decoration.widget(offset + node.nodeSize - 1, marker, { side: 1 }),
      )
    }
    return false
  })
  return decorations
}

// Decorations are a pure function of the document, so the same document never
// pays for them twice.
const cache = new WeakMap<PMNode, DecorationSet>()

/** Every marker in a document, which is what the plugin starts from. */
export function requiredDecorations(doc: PMNode): DecorationSet {
  const cached = cache.get(doc)
  if (cached !== undefined) return cached
  const set = DecorationSet.create(doc, [...markers(doc, 0, doc.content.size)])
  cache.set(doc, set)
  return set
}

export const requiredSectionsKey = new PluginKey<DecorationSet>('requiredSections')

export const RequiredSections = Extension.create({
  name: 'requiredSections',
  addProseMirrorPlugins: () => [
    new Plugin<DecorationSet>({
      key: requiredSectionsKey,
      state: {
        init: (_, state) => requiredDecorations(state.doc),
        apply: (transaction, set, before) =>
          before.doc.firstChild === transaction.doc.firstChild
            ? redecorateChangedBlocks(set, transaction, markers)
            : requiredDecorations(transaction.doc),
      },
      props: { decorations: (state) => requiredSectionsKey.getState(state) },
    }),
  ],
})
