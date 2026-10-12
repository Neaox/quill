import { CALLOUT_TYPES, DEFAULT_CALLOUT_TYPE, isCalloutType } from '@quill/markdown'
import type { CalloutType } from '@quill/markdown'
import { buttonClassName } from '@quill/ui'
import type { Extensions, NodeConfig } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { Decoration } from '@tiptap/pm/view'
import type { EditorView as ProseMirrorView, NodeView } from '@tiptap/pm/view'
import { tv } from 'tailwind-variants'

import { calloutTitleOf } from '../callout/callout-title.ts'
import { TableBlockView } from '../table/table-view.ts'
import { dismiss, isDismissed } from './dismissal.ts'

/**
 * The template blocks, as the author meets them (ADR-029).
 *
 * `:::guidance` is a hint card that can be waved away, `:::optional` is an offer
 * rather than content, and a callout is an aside a reader will notice. All three
 * are the same node — a container directive — so they are one node view that
 * reads the directive's name, rather than three that each re-implement content
 * handling.
 *
 * Dismissing a guidance card changes the view and not the document: the block is
 * still there, still published-and-removed by the publish step, and still present
 * for the next person who opens the draft.
 */

/**
 * The card in one definition. Whether it has been dismissed, and whether an
 * offered section has been accepted, are attributes on the element; the colours
 * follow them as variants rather than being chosen in code.
 */
const card = tv({
  slots: {
    root: 'directive',
    content: 'directive-content',
  },
  variants: {
    // A callout is drawn by the reader's own `.callout` and nothing else: a card
    // frame around it would be a second outline the published page does not have.
    framed: {
      true: {
        root:
          'rounded-md border border-border-strong/50 bg-surface px-4 py-3 ' +
          'data-[dismissed=true]:opacity-70 data-[added=false]:border-dashed',
      },
    },
  },
})

interface Chrome {
  readonly tag: 'aside' | 'section' | 'div'
  readonly role?: string
  /** A card the author can wave away for this session. */
  readonly dismissible?: boolean
  /** Content the author has to accept before it is content at all. */
  readonly gated?: boolean
  /** A callout, drawn in its tone as a reader sees it. */
  readonly toned?: boolean
  /** What the block is, as a small heading in it: for a block that is the author's alone and says so. */
  readonly heading?: string
  label(node: PMNode): string
}

/** A callout's tone: its `type`, or a note for one the reader would not know either. */
function toneOf(node: PMNode): CalloutType {
  const type = attributesOf(node)['type']
  return isCalloutType(type) ? type : DEFAULT_CALLOUT_TYPE
}

function attributesOf(node: PMNode): Readonly<Record<string, string>> {
  const attributes = node.attrs['attributes']
  if (typeof attributes !== 'object' || attributes === null) return {}
  return Object.fromEntries(
    Object.entries(attributes).map(([key, value]) => [key, String(value ?? '')]),
  )
}

function titleOf(node: PMNode): string {
  return attributesOf(node)['title'] ?? 'Optional section'
}

const CHROME: Readonly<Record<string, Chrome>> = {
  guidance: { tag: 'aside', role: 'note', dismissible: true, label: () => 'Guidance' },
  optional: { tag: 'section', gated: true, label: (node) => `Optional: ${titleOf(node)}` },
  // `<aside role="group">` is not a valid ARIA-in-HTML combination — `aside`'s
  // allowed roles are `note`, `region`, `search`, `feed` and a few `doc-*`
  // roles, not `group` — so this one is a `div` rather than the semantic
  // element the others use.
  callout: {
    tag: 'div',
    role: 'group',
    toned: true,
    label: (node) => `Callout: ${attributesOf(node)['type'] ?? 'note'}`,
  },
  placeholder: { tag: 'div', label: () => 'Placeholder' },
  // What the presenter says, which no reader ever sees (ADR-050): the author is told so in the block.
  notes: { tag: 'aside', role: 'note', heading: 'Presenter notes', label: () => 'Presenter notes' },
  // Details where opening one closes the others (ADR-048).
  accordion: { tag: 'div', role: 'group', label: () => 'Accordion' },
}

const DEFAULT_CHROME: Chrome = {
  tag: 'div',
  label: (node) => String(node.attrs['name'] ?? 'directive'),
}

function chromeFor(node: PMNode): Chrome {
  const name = node.attrs['name']
  return (typeof name === 'string' ? CHROME[name] : undefined) ?? DEFAULT_CHROME
}

export function isAdded(node: PMNode): boolean {
  return Object.hasOwn(attributesOf(node), 'added')
}

export class DirectiveNodeView implements NodeView {
  readonly dom: HTMLElement
  readonly contentDOM: HTMLElement
  private node: PMNode
  private readonly view: ProseMirrorView
  private readonly getPos: () => number | undefined
  private readonly action: HTMLButtonElement
  /** A callout's tone in words, as the reader titles it; its icon and colours are `prose.css`'s. */
  private readonly tone: HTMLElement
  /** The small heading of a block that says what it is (presenter notes), drawn as a callout's title is. */
  private readonly heading: HTMLElement
  private dismissed: boolean

  constructor(
    node: PMNode,
    view: ProseMirrorView,
    getPos: () => number | undefined,
    decorations: readonly Decoration[],
  ) {
    this.node = node
    this.view = view
    this.getPos = getPos
    this.dismissed = isDismissed(decorations)
    const chrome = chromeFor(node)

    this.dom = document.createElement(chrome.tag)
    this.dom.className = card({ framed: chrome.toned !== true }).root({
      class: `directive-${String(node.attrs['name'] ?? 'unknown')}`,
    })
    if (chrome.role !== undefined) this.dom.setAttribute('role', chrome.role)

    this.action = document.createElement('button')
    this.action.type = 'button'
    this.action.className = buttonClassName({
      variant: 'ghost',
      size: 'sm',
      className: 'directive-action',
    })
    this.action.setAttribute('contenteditable', 'false')
    this.action.addEventListener('click', () => {
      this.act()
    })

    // Hidden from assistive technology: the group's own name already says it.
    this.tone = document.createElement('p')
    this.tone.className = 'callout-label'
    this.tone.setAttribute('contenteditable', 'false')
    this.tone.setAttribute('aria-hidden', 'true')
    this.tone.title = 'Change the callout’s type'

    // Hidden from assistive technology for the same reason: the block's own name already says it.
    this.heading = document.createElement('p')
    this.heading.className = 'callout-label directive-heading'
    this.heading.setAttribute('contenteditable', 'false')
    this.heading.setAttribute('aria-hidden', 'true')
    this.heading.textContent = chrome.heading ?? ''

    this.contentDOM = document.createElement('div')
    this.contentDOM.className = card().content()
    this.dom.append(this.contentDOM)
    if (chrome.heading !== undefined) this.dom.prepend(this.heading)
    this.render()
  }

  private act(): void {
    const pos = this.getPos()
    if (pos === undefined) return
    if (chromeFor(this.node).dismissible === true) {
      dismiss(pos)(this.view.state, this.view.dispatch)
      return
    }
    this.add(pos)
  }

  /** Accepting an offered section: the directive keeps the `added` flag (ADR-029). */
  private add(pos: number): void {
    const attributes = { ...attributesOf(this.node), added: '' }
    this.view.dispatch(this.view.state.tr.setNodeAttribute(pos, 'attributes', attributes))
    this.view.focus()
  }

  /**
   * A callout drawn in its tone (WCAG 1.4.1): the reader's own classes, so its
   * stripe, colour and icon come from the same tokens as the published one,
   * and its tone's name above the words.
   */
  private showTone(): void {
    const tone = toneOf(this.node)
    this.dom.classList.add('callout')
    for (const type of CALLOUT_TYPES) this.dom.classList.toggle(`callout-${type}`, type === tone)
    // With a title of its own the callout is headed by that, as it is on the page, and
    // the tone's name is left to the icon and colour; without one, the name is the heading.
    if (calloutTitleOf(this.node) === undefined) {
      this.tone.textContent = tone.slice(0, 1).toUpperCase() + tone.slice(1)
      this.dom.prepend(this.tone)
    } else {
      this.tone.remove()
    }
  }

  private render(): void {
    const chrome = chromeFor(this.node)
    const gatedShut = chrome.gated === true && !isAdded(this.node)
    this.dom.setAttribute('aria-label', chrome.label(this.node))
    this.dom.dataset['added'] = String(!gatedShut)
    if (chrome.toned === true) this.showTone()

    // Taken out of the DOM rather than hidden in it: an affordance that is not
    // offered should not be in the reading order or the accessibility tree.
    const showAction = chrome.dismissible === true ? !this.dismissed : gatedShut
    if (showAction) this.dom.prepend(this.action)
    else this.action.remove()
    this.action.textContent =
      chrome.dismissible === true ? 'Dismiss' : `Add section: ${titleOf(this.node)}`
    this.action.setAttribute(
      'aria-label',
      chrome.dismissible === true ? 'Dismiss guidance' : `Add section: ${titleOf(this.node)}`,
    )
    this.contentDOM.hidden = gatedShut || this.dismissed
  }

  update(node: PMNode, decorations: readonly Decoration[]): boolean {
    if (node.type !== this.node.type || node.attrs['name'] !== this.node.attrs['name']) return false
    this.node = node
    this.dismissed = isDismissed(decorations)
    this.render()
    return true
  }

  stopEvent(event: Event): boolean {
    return event.target === this.action
  }

  /**
   * The chrome is the view's, not the document's. Without this, showing or hiding
   * a button counts as the document changing under ProseMirror, which redraws the
   * node view and forgets that the author dismissed the card a moment ago.
   */
  ignoreMutation(mutation: MutationRecord | { target: Node }): boolean {
    return !this.contentDOM.contains(mutation.target)
  }
}

const withView: Partial<NodeConfig> = {
  addNodeView:
    () =>
    ({ node, editor, getPos, decorations }) =>
      // A `:::table` wrapper is drawn as the table's card (ADR-040).
      node.attrs['name'] === 'table'
        ? new TableBlockView(node)
        : new DirectiveNodeView(node, editor.view, getPos, decorations),
}

/** Gives container directives their author-facing chrome. */
export function withDirectiveViews(extensions: Extensions): Extensions {
  return extensions.map((extension) =>
    extension.type === 'node' && extension.name === 'containerDirective'
      ? extension.extend(withView)
      : extension,
  )
}
