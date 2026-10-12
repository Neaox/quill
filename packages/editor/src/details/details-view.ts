import { knownCalloutKind } from '@quill/markdown'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { Command } from '@tiptap/pm/state'
import type { Decoration, EditorView, NodeView } from '@tiptap/pm/view'

import { isOpenByDefault, setOpenByDefault } from './details-commands.ts'
import { isFolded, setFolded } from './details-folds.ts'

/**
 * A details in the editor (ADR-048), drawn as the reader draws it — the same
 * frame, rules and indent — with its summary line and its body both editable
 * in place, as Confluence's expand is.
 *
 * Two controls, and they mean different things:
 *
 * - **The chevron** opens and closes the details while writing. That is the
 *   view's (`details-folds.ts`): the document does not change, undo does not
 *   see it, and the details opens again by itself when the caret goes into
 *   its body.
 * - **Open by default** is the document's `open`: whether a reader finds it
 *   open. A change to the document, so one step of undo.
 */

const CHEVRON =
  '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false"><path d="m6 3.5 4.5 4.5L6 12.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
const CHECK =
  '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false"><path d="m3.5 8.5 3 3 6-7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'

function button(className: string): HTMLButtonElement {
  const created = document.createElement('button')
  created.type = 'button'
  created.className = className
  created.contentEditable = 'false'
  return created
}

function kindOf(node: PMNode): string | undefined {
  const attributes: unknown = node.attrs['attributes']
  if (typeof attributes !== 'object' || attributes === null || !('type' in attributes))
    return undefined
  const { type } = attributes
  return typeof type === 'string' ? (knownCalloutKind(type) ?? 'note') : undefined
}

export class DetailsNodeView implements NodeView {
  readonly dom: HTMLElement
  readonly contentDOM: HTMLElement
  private node: PMNode
  private folded: boolean
  private readonly view: EditorView
  private readonly getPos: () => number | undefined
  private readonly toggle: HTMLButtonElement
  private readonly openByDefault: HTMLButtonElement

  constructor(
    node: PMNode,
    view: EditorView,
    getPos: () => number | undefined,
    decorations: readonly Decoration[],
  ) {
    this.node = node
    this.view = view
    this.getPos = getPos
    this.folded = isFolded(decorations)

    this.dom = document.createElement('div')
    this.dom.setAttribute('role', 'group')

    this.toggle = button('details-editor-toggle')
    this.toggle.innerHTML = CHEVRON
    this.toggle.addEventListener('click', () => {
      this.run((pos) => setFolded(pos, !this.folded))
    })

    this.openByDefault = button('details-editor-default')
    this.openByDefault.innerHTML = CHECK
    this.openByDefault.append('Open by default')
    this.openByDefault.title = 'Whether a reader finds this open'
    this.openByDefault.addEventListener('click', () => {
      this.run((pos) => setOpenByDefault(pos, !isOpenByDefault(this.node)))
      this.view.focus()
    })

    this.contentDOM = document.createElement('div')
    this.contentDOM.className = 'details-editor-content'
    this.dom.append(this.toggle, this.openByDefault, this.contentDOM)
    this.render()
  }

  private run(command: (pos: number) => Command): void {
    const pos = this.getPos()
    if (pos !== undefined) command(pos)(this.view.state, this.view.dispatch)
  }

  private render(): void {
    const summary = this.node.firstChild?.textContent ?? ''
    const kind = kindOf(this.node)
    this.dom.className = [
      'details',
      'details-editor',
      ...(kind === undefined ? [] : ['callout', `callout-${kind}`]),
    ].join(' ')
    this.dom.setAttribute('aria-label', summary === '' ? 'Details' : `Details: ${summary}`)
    this.dom.toggleAttribute('data-summary-empty', summary === '')
    this.toggle.setAttribute('aria-expanded', String(!this.folded))
    this.toggle.setAttribute(
      'aria-label',
      this.folded ? 'Show the body while editing' : 'Hide the body while editing',
    )
    this.openByDefault.setAttribute('aria-pressed', String(isOpenByDefault(this.node)))
  }

  update(node: PMNode, decorations: readonly Decoration[]): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    this.folded = isFolded(decorations)
    this.render()
    return true
  }

  stopEvent(event: Event): boolean {
    const { target } = event
    return (
      target instanceof Node &&
      (this.toggle.contains(target) || this.openByDefault.contains(target))
    )
  }

  /** The controls are the view's; only the content is the document's. */
  ignoreMutation(mutation: MutationRecord | { target: Node }): boolean {
    return !this.contentDOM.contains(mutation.target)
  }
}
