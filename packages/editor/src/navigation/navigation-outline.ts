import { createSlugger, headingId, TOC_DIRECTIVE_NAME } from '@quill/markdown'
import type { OutlineEntry } from '@quill/markdown'
import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { Transaction } from '@tiptap/pm/state'
import { AttrStep, ReplaceAroundStep, ReplaceStep } from '@tiptap/pm/transform'
import type { Step } from '@tiptap/pm/transform'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

/**
 * The document's headings, as a table of contents in the editor sees them
 * (ADR-058): the ids the reader will give them, by the same slugger in the
 * same order, and where each one is in the editor, so a click on an entry
 * puts the caret there.
 *
 * Handed to every table of contents as a node decoration, which is how a node
 * view learns of something outside itself: ProseMirror calls the view's
 * `update` with the new decorations, and the view redraws only when the
 * headings' signature has changed. A document with no table of contents is
 * never walked on a keystroke: it is walked again only when a change puts
 * one in (quill-plan.md section 31). One that has one is walked once per
 * change, stopping at every text block.
 */

export interface EditorHeading extends OutlineEntry {
  /** Where the heading starts in the editor's document. */
  readonly pos: number
}

export interface NavigationOutlineSpec {
  readonly kind: 'navigation-outline'
  readonly headings: readonly EditorHeading[]
  /** Changes exactly when an entry would: an id, a text, a depth or the order. */
  readonly signature: string
}

export function isNavigationOutlineSpec(spec: unknown): spec is NavigationOutlineSpec {
  return (
    typeof spec === 'object' && spec !== null && Reflect.get(spec, 'kind') === 'navigation-outline'
  )
}

/** Presenter notes are not part of what a reader reads, so their headings are not either. */
function isPresenterNotes(node: PMNode): boolean {
  return node.type.name === 'containerDirective' && node.attrs['name'] === 'notes'
}

function isTableOfContents(node: PMNode): boolean {
  return node.type.name === 'leafDirective' && node.attrs['name'] === TOC_DIRECTIVE_NAME
}

/** Every heading, and every table of contents, in one walk over the blocks. */
export function editorHeadings(doc: PMNode): {
  readonly headings: readonly EditorHeading[]
  readonly contents: readonly { readonly from: number; readonly to: number }[]
} {
  const slug = createSlugger()
  const headings: EditorHeading[] = []
  const contents: { from: number; to: number }[] = []
  doc.descendants((node, pos) => {
    if (isPresenterNotes(node)) return false
    if (isTableOfContents(node)) contents.push({ from: pos, to: pos + node.nodeSize })
    if (node.type.name === 'heading') {
      const text = node.textContent
      const depth = Number(node.attrs['level'])
      headings.push({ id: headingId(slug(text)), text, depth, pos, children: [] })
    }
    return !node.isTextblock
  })
  return { headings, contents }
}

interface Outline {
  readonly decorations: DecorationSet
  /** How many tables of contents there were, so a document with none is left alone. */
  readonly contents: number
}

function outlineOf(doc: PMNode): Outline {
  const { headings, contents } = editorHeadings(doc)
  if (contents.length === 0) return { decorations: DecorationSet.empty, contents: 0 }
  const spec: NavigationOutlineSpec = {
    kind: 'navigation-outline',
    headings,
    signature: JSON.stringify(headings.map(({ id, text, depth }) => [id, text, depth])),
  }
  return {
    decorations: DecorationSet.create(
      doc,
      contents.map(({ from, to }) => Decoration.node(from, to, {}, spec)),
    ),
    contents: contents.length,
  }
}

/** Whether a step can put a table of contents into the document. */
function addsContents(step: Step): boolean {
  if (step instanceof AttrStep) return step.attr === 'name' && step.value === TOC_DIRECTIVE_NAME
  if (!(step instanceof ReplaceStep || step instanceof ReplaceAroundStep)) return false
  let found = false
  step.slice.content.descendants((node) => {
    found ||= isTableOfContents(node)
    return !found
  })
  return found
}

function nextOutline(tr: Transaction, previous: Outline): Outline {
  if (!tr.docChanged) return previous
  if (previous.contents === 0 && !tr.steps.some(addsContents)) return previous
  return outlineOf(tr.doc)
}

const outlineKey = new PluginKey<Outline>('navigationOutline')

export const NavigationOutline = Extension.create({
  name: 'navigationOutline',
  addProseMirrorPlugins() {
    return [
      new Plugin<Outline>({
        key: outlineKey,
        state: {
          init: (_config, state) => outlineOf(state.doc),
          apply: nextOutline,
        },
        props: { decorations: (state) => outlineKey.getState(state)?.decorations },
      }),
    ]
  },
})
