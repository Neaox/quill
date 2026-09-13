import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

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

/** The headings a template declares as required, read from the document itself. */
export function requiredHeadings(doc: PMNode): ReadonlySet<string> {
  const first = doc.firstChild
  if (first === null || first.type.name !== 'frontMatter') return new Set()
  const declaration = templateDeclaration(String(first.attrs['value']))
  if (declaration === undefined) return new Set()
  return new Set(
    declaration.sections
      .filter((section) => section.required === true)
      .map((section) => section.heading),
  )
}

// Decorations are a pure function of the document, so the same document never
// pays for them twice — and a keystroke elsewhere in a long document does not
// re-scan every heading.
const cache = new WeakMap<PMNode, DecorationSet>()

export function requiredDecorations(doc: PMNode): DecorationSet {
  const cached = cache.get(doc)
  if (cached !== undefined) return cached

  const required = requiredHeadings(doc)
  const decorations: Decoration[] = []
  if (required.size > 0) {
    doc.forEach((node, offset) => {
      if (node.type.name !== 'heading' || !required.has(node.textContent.trim())) return
      decorations.push(
        Decoration.node(offset, offset + node.nodeSize, { 'data-required-section': 'true' }),
        Decoration.widget(offset + node.nodeSize - 1, marker, { side: 1 }),
      )
    })
  }
  const set = DecorationSet.create(doc, decorations)
  cache.set(doc, set)
  return set
}

export const requiredSectionsKey = new PluginKey('requiredSections')

export const RequiredSections = Extension.create({
  name: 'requiredSections',
  addProseMirrorPlugins: () => [
    new Plugin({
      key: requiredSectionsKey,
      props: { decorations: (state) => requiredDecorations(state.doc) },
    }),
  ],
})
