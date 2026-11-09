import {
  BUILT_IN_BLOCK_REGISTRY,
  isQuillDirective,
  readProps,
} from '@quill/markdown/component-blocks'
import { buttonClassName } from '@quill/ui'
import type { Extensions, NodeConfig } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { Decoration } from '@tiptap/pm/view'
import type { EditorView as ProseMirrorView, NodeView } from '@tiptap/pm/view'
import { tv } from 'tailwind-variants'

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
    root:
      'directive rounded-md border border-border-strong/50 bg-surface px-4 py-3 ' +
      'data-[dismissed=true]:opacity-70 data-[added=false]:border-dashed',
    content: 'directive-content',
    // A component block's heading (ADR-060): what it is, as it is written.
    head:
      'directive-block-head mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-1 ' +
      'font-sans text-xs leading-snug text-muted select-none',
    title: 'font-medium text-body',
    source: 'font-mono text-xs break-all',
    issue: 'basis-full text-warning',
  },
})

const styles = card()

interface Chrome {
  readonly tag: 'aside' | 'section' | 'div'
  readonly role?: string
  /** A card the author can wave away for this session. */
  readonly dismissible?: boolean
  /** Content the author has to accept before it is content at all. */
  readonly gated?: boolean
  label(node: PMNode): string
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
    label: (node) => `Callout: ${attributesOf(node)['type'] ?? 'note'}`,
  },
  placeholder: { tag: 'div', label: () => 'Placeholder' },
  // Details where opening one closes the others (ADR-048).
  accordion: { tag: 'div', role: 'group', label: () => 'Accordion' },
}

const DEFAULT_CHROME: Chrome = {
  tag: 'div',
  label: (node) => String(node.attrs['name'] ?? 'directive'),
}

/** How a directive's attributes read on its card: as they would be written. */
function writtenAttributes(attributes: Readonly<Record<string, string>>): string {
  const written = Object.entries(attributes).map(([key, value]) =>
    value === '' ? key : `${key}="${value}"`,
  )
  return written.length === 0 ? '' : `{${written.join(' ')}}`
}

/** Where a prop comes in its block's declaration; one it does not declare comes last. */
function rank(declared: readonly string[], name: string): number {
  const index = declared.indexOf(name)
  return index === -1 ? declared.length : index
}

interface BlockHeading {
  readonly title: string
  readonly source: string
  readonly issues: readonly string[]
}

/**
 * What a component block's card says above its content (ADR-060): the
 * block's title, or that no block has the name, its directive as written,
 * and what is wrong with its props. Quill's own directives have chrome of
 * their own, or none, and get no heading.
 */
function blockHeading(node: PMNode): BlockHeading | undefined {
  const name = node.attrs['name']
  if (typeof name !== 'string' || isQuillDirective(name)) return undefined
  const attributes = attributesOf(node)
  const block = BUILT_IN_BLOCK_REGISTRY.find(name, 'container')
  if (block === undefined) {
    return { title: 'Unknown block', source: `${name}${writtenAttributes(attributes)}`, issues: [] }
  }
  // In the order the block declares its props, whatever order they were stored in.
  const declared = Object.keys(block.props)
  const ordered = Object.fromEntries(
    Object.entries(attributes).toSorted(([a], [b]) => rank(declared, a) - rank(declared, b)),
  )
  const { issues } = readProps(block.props, attributes)
  return {
    title: block.title,
    source: `${name}${writtenAttributes(ordered)}`,
    issues: issues.map((each) => each.message),
  }
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
  private readonly head: HTMLElement
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
    this.dom.className = styles.root({
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
    this.action.contentEditable = 'false'
    this.action.addEventListener('click', () => {
      this.act()
    })

    this.head = document.createElement('div')
    this.head.className = styles.head()
    this.head.setAttribute('contenteditable', 'false')

    this.contentDOM = document.createElement('div')
    this.contentDOM.className = styles.content()
    this.dom.append(this.contentDOM)
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

  private render(): void {
    const chrome = chromeFor(this.node)
    const gatedShut = chrome.gated === true && !isAdded(this.node)
    const heading = blockHeading(this.node)
    this.dom.setAttribute(
      'aria-label',
      heading === undefined ? chrome.label(this.node) : `${heading.title}: ${heading.source}`,
    )
    this.renderHeading(heading)
    this.dom.dataset['added'] = String(!gatedShut)

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

  /** The heading a component block's card carries, or none. */
  private renderHeading(heading: BlockHeading | undefined): void {
    if (heading === undefined) {
      this.head.remove()
      return
    }
    const title = document.createElement('span')
    title.className = styles.title()
    title.textContent = heading.title
    const source = document.createElement('code')
    source.className = styles.source()
    source.textContent = heading.source
    const issues = heading.issues.map((message) => {
      const issue = document.createElement('span')
      issue.className = styles.issue()
      issue.textContent = message
      return issue
    })
    this.head.replaceChildren(title, source, ...issues)
    this.dom.dataset['issues'] = String(heading.issues.length > 0)
    if (this.head.parentNode !== this.dom) this.dom.prepend(this.head)
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
