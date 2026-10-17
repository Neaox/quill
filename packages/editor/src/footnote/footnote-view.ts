import { Extension } from '@tiptap/core'
import type { Extensions, NodeConfig } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import type { Transaction } from '@tiptap/pm/state'
import { ReplaceAroundStep, ReplaceStep } from '@tiptap/pm/transform'
import type { Step } from '@tiptap/pm/transform'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { EditorView, NodeView } from '@tiptap/pm/view'

/**
 * Footnote references, numbered and linked as the reader shows them (WCAG
 * 1.3.1). The node is an atom with no text of its own, so without this the
 * editor drew an empty `<sup>`: invisible, silent, and lost while writing.
 *
 * A reference shows the number its note will have when published: notes are
 * numbered by their first reference, in document order, as GitHub numbers
 * them, so two references to one note share its number. The number is a link
 * to the note, named "Footnote 2"; following it puts the caret in the note.
 *
 * The numbers are one pass over the document, kept as decorations, and only
 * taken again when a change could alter them: one that adds a reference, or
 * one that removes a reference or a note. A document without footnotes is
 * never walked on a keystroke (quill-plan.md section 31).
 */

const REFERENCE = 'footnoteReference'
const DEFINITION = 'footnoteDefinition'

interface FootnoteSpec {
  readonly footnote: number
  readonly target: string
}

function isFootnoteSpec(spec: unknown): spec is FootnoteSpec {
  return typeof spec === 'object' && spec !== null && 'footnote' in spec && 'target' in spec
}

interface Numbering {
  readonly decorations: DecorationSet
  /** How many decorations were made, so a change that removed one is noticed. */
  readonly count: number
}

const EMPTY: Numbering = { decorations: DecorationSet.empty, count: 0 }

function identifierOf(node: PMNode): string {
  return String(node.attrs['identifier'] ?? '')
}

/** Every reference numbered by first appearance, and every note given the id its references link to. */
function numberFootnotes(doc: PMNode, prefix: string): Numbering {
  const numbers = new Map<string, number>()
  const decorations: Decoration[] = []
  const notes: { readonly node: PMNode; readonly pos: number }[] = []
  doc.descendants((node, pos) => {
    if (node.type.name === DEFINITION) notes.push({ node, pos })
    if (node.type.name !== REFERENCE) return true
    const identifier = identifierOf(node)
    const number = numbers.get(identifier) ?? numbers.size + 1
    numbers.set(identifier, number)
    const spec: FootnoteSpec = { footnote: number, target: `${prefix}-${String(number)}` }
    decorations.push(Decoration.node(pos, pos + node.nodeSize, {}, spec))
    return false
  })
  for (const { node, pos } of notes) {
    const number = numbers.get(identifierOf(node))
    if (number === undefined) continue
    const id = `${prefix}-${String(number)}`
    decorations.push(Decoration.node(pos, pos + node.nodeSize, { id }))
  }
  return decorations.length === 0
    ? EMPTY
    : { decorations: DecorationSet.create(doc, decorations), count: decorations.length }
}

/** Whether a step puts a footnote reference into the document. */
function addsReference(step: Step): boolean {
  if (!(step instanceof ReplaceStep || step instanceof ReplaceAroundStep)) return false
  let found = false
  step.slice.content.descendants((node) => {
    found ||= node.type.name === REFERENCE
    return !found
  })
  return found
}

function renumber(tr: Transaction, previous: Numbering, prefix: string): Numbering {
  if (!tr.docChanged) return previous
  if (tr.steps.some(addsReference)) return numberFootnotes(tr.doc, prefix)
  if (previous.count === 0) return previous
  const decorations = previous.decorations.map(tr.mapping, tr.doc)
  return decorations.find().length === previous.count
    ? { decorations, count: previous.count }
    : numberFootnotes(tr.doc, prefix)
}

const numbering = new PluginKey<Numbering>('footnoteNumbers')

let editors = 0

function footnoteNumbers(): Plugin<Numbering> {
  editors += 1
  // Per editor, so two editors on one page never link into each other's notes.
  const prefix = `editor-${String(editors)}-footnote`
  return new Plugin<Numbering>({
    key: numbering,
    state: {
      init: (_config, state) => numberFootnotes(state.doc, prefix),
      apply: (tr, previous) => renumber(tr, previous, prefix),
    },
    props: {
      decorations: (state) => numbering.getState(state)?.decorations,
    },
  })
}

export const FootnoteNumbers = Extension.create({
  name: 'footnoteNumbers',
  addProseMirrorPlugins() {
    return [footnoteNumbers()]
  },
})

export class FootnoteReferenceView implements NodeView {
  readonly dom: HTMLElement
  private readonly link: HTMLAnchorElement
  private node: PMNode

  constructor(node: PMNode, view: EditorView, decorations: readonly Decoration[]) {
    this.node = node
    this.dom = document.createElement('sup')
    this.dom.className = 'footnote-reference'
    this.dom.contentEditable = 'false'
    this.link = document.createElement('a')
    this.link.addEventListener('click', (event) => {
      event.preventDefault()
      this.follow(view)
    })
    this.dom.append(this.link)
    this.render(decorations)
  }

  private render(decorations: readonly Decoration[]): void {
    const specs: unknown[] = decorations.map((decoration) => decoration.spec)
    const spec = specs.find(isFootnoteSpec)
    const number = spec === undefined ? '' : String(spec.footnote)
    this.link.textContent = number
    this.link.href = `#${spec?.target ?? ''}`
    this.link.setAttribute('aria-label', `Footnote ${number}`.trim())
  }

  /** Puts the caret at the start of the note this reference points to. */
  private follow(view: EditorView): void {
    const identifier = identifierOf(this.node)
    let target: number | undefined
    view.state.doc.descendants((node, pos) => {
      const found = node.type.name === DEFINITION && identifierOf(node) === identifier
      if (target === undefined && found) target = pos
      return target === undefined
    })
    if (target === undefined) return
    const selection = TextSelection.near(view.state.doc.resolve(target + 1))
    view.dispatch(view.state.tr.setSelection(selection).scrollIntoView())
    view.focus()
  }

  update(node: PMNode, decorations: readonly Decoration[]): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    this.render(decorations)
    return true
  }

  /** The link is the view's own: ProseMirror does not select the atom when it is followed. */
  stopEvent(event: Event): boolean {
    return event.target instanceof Node && this.link.contains(event.target)
  }

  /** The whole reference is drawn by the view; nothing in it is the document's text. */
  ignoreMutation(): boolean {
    return true
  }
}

const withView: Partial<NodeConfig> = {
  addNodeView:
    () =>
    ({ node, editor, decorations }) =>
      new FootnoteReferenceView(node, editor.view, decorations),
}

/** Gives footnote references their number. */
export function withFootnoteView(extensions: Extensions): Extensions {
  return extensions.map((extension) =>
    extension.type === 'node' && extension.name === REFERENCE
      ? extension.extend(withView)
      : extension,
  )
}
