import type { Extensions, NodeConfig, NodeViewRenderer } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { NodeView } from '@tiptap/pm/view'

import { CALLOUT_LABELS, calloutOf } from './callout.ts'
import type { CalloutRef } from './callout.ts'

/**
 * A callout drawn while it is written exactly as it is read: the reader's
 * own classes (`.callout`, `.callout-<type>`, `.callout-label`, from
 * `prose.css`), so the tone, the icon and the type in words come from one
 * stylesheet in both places (WCAG 1.4.1: never colour alone).
 *
 * The title line is the view's, not the document's: it says the type and is
 * the button that changes it, which opens the type switcher
 * (`callout-menu.ts`). An alert's marker never appears as text — the quote
 * carries it (`@quill/markdown`'s `alert.ts`) — and a directive's own title is
 * the first line of its body, editable like any other.
 */

/** What the view asks of the editor around it. */
export interface CalloutViewOptions {
  /** The type button was pressed: open the switcher, anchored on the button. */
  onTypeMenu?(request: CalloutMenuRequest): void
}

export interface CalloutMenuRequest {
  /** The position before the callout. */
  readonly pos: number
  readonly anchor: HTMLElement
}

const CHEVRON =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" ' +
  'class="callout-type-chevron"><path d="m4.75 6.5 3.25 3.25 3.25-3.25"/></svg>'

export class CalloutView implements NodeView {
  readonly dom: HTMLElement
  readonly contentDOM: HTMLElement
  private readonly button: HTMLButtonElement
  private readonly word: HTMLSpanElement
  private callout: CalloutRef

  private readonly getPos: () => number | undefined

  constructor(callout: CalloutRef, getPos: () => number | undefined, options: CalloutViewOptions) {
    this.callout = callout
    this.getPos = getPos
    this.dom = document.createElement('div')
    this.dom.setAttribute('role', 'group')

    const label = document.createElement('div')
    label.className = 'callout-label'
    label.contentEditable = 'false'

    this.button = document.createElement('button')
    this.button.type = 'button'
    this.button.className = 'callout-type'
    this.button.setAttribute('aria-haspopup', 'menu')
    this.word = document.createElement('span')
    const hint = document.createElement('span')
    hint.className = 'sr-only'
    hint.textContent = ', change type'
    this.button.append(this.word, hint)
    this.button.insertAdjacentHTML('beforeend', CHEVRON)
    this.button.addEventListener('mousedown', (event) => {
      // The caret stays where it was; the menu acts on this callout by position.
      event.preventDefault()
    })
    this.button.addEventListener('click', () => {
      const pos = this.getPos()
      if (pos !== undefined) options.onTypeMenu?.({ pos, anchor: this.button })
    })
    label.append(this.button)

    this.contentDOM = document.createElement('div')
    this.contentDOM.className = 'callout-body'
    this.dom.append(label, this.contentDOM)
    this.render()
  }

  private render(): void {
    const { type, syntax } = this.callout
    const kind = CALLOUT_LABELS[type]
    this.dom.className = `callout callout-${type}`
    this.dom.dataset['syntax'] = syntax
    this.dom.setAttribute('aria-label', `${kind} callout`)
    this.word.textContent = kind
  }

  update(node: PMNode): boolean {
    const next = calloutOf(node, this.callout.pos)
    if (next?.syntax !== this.callout.syntax) return false
    this.callout = next
    this.render()
    return true
  }

  stopEvent(event: Event): boolean {
    return event.target instanceof Node && this.button.contains(event.target)
  }

  /** The title line is the view's own; only the body is the document. */
  ignoreMutation(mutation: MutationRecord | { readonly target: Node }): boolean {
    return !this.contentDOM.contains(mutation.target)
  }
}

/** A quote that is not an alert, drawn as ProseMirror would draw it without a view. */
class QuoteView implements NodeView {
  readonly dom: HTMLElement
  readonly contentDOM: HTMLElement

  constructor() {
    this.dom = document.createElement('blockquote')
    this.dom.className = 'blockquote'
    this.contentDOM = this.dom
  }

  update(node: PMNode): boolean {
    return node.type.name === 'blockquote' && calloutOf(node, 0) === undefined
  }
}

function calloutViews(
  options: CalloutViewOptions,
  parent: NodeViewRenderer | null | undefined,
): NodeViewRenderer {
  // A quote has no view of its own to fall back to; every other directive
  // keeps the one it had (`template/directive-view.ts`).
  const otherwise = parent ?? (() => new QuoteView())
  return (props) => {
    const callout = calloutOf(props.node, 0)
    return callout === undefined
      ? otherwise(props)
      : new CalloutView(callout, props.getPos, options)
  }
}

/**
 * Gives alerts and `:::callout` directives their callout view. Applied over
 * the directive views, so every other directive keeps its own.
 */
export function withCalloutViews(
  extensions: Extensions,
  options: CalloutViewOptions = {},
): Extensions {
  return extensions.map((extension) => {
    if (extension.type !== 'node') return extension
    if (extension.name !== 'blockquote' && extension.name !== 'containerDirective') return extension
    const config: Partial<NodeConfig> = {
      addNodeView() {
        return calloutViews(options, this.parent?.())
      },
    }
    return extension.extend(config)
  })
}
