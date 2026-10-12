import type { Extensions, NodeConfig } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { Command } from '@tiptap/pm/state'
import type { NodeView } from '@tiptap/pm/view'

/**
 * Actions on an image in the editor (ADR-039, an extension's editor binding:
 * "an image node with an editor binding"). draw.io's "Edit diagram" is the
 * first: shown on an image that is a draw.io diagram, and run by the
 * application, which owns the editor it opens.
 *
 * The image is still the Markdown package's `image` node, written back as
 * `![alt](src "title")` exactly as before; only its view changes, to the
 * picture with a small bar of buttons over its corner, shown on hover and
 * focus (and always on a touch screen, which has no hover). Nothing in the
 * document changes when an action applies or stops applying.
 *
 * Which images an action applies to can change while the editor is open —
 * a diagram is saved, the document's attachments arrive — so an action may
 * offer `subscribe`, and every image view re-asks when it fires. An action
 * may also say which address to *show* for an image (`displaySrc`), so a
 * diagram re-saved under the same address is drawn fresh rather than from a
 * cached copy, without the address in the Markdown changing.
 */

export interface ImageRef {
  readonly src: string
  readonly alt: string | null
  readonly title: string | null
  /** Where the image is in the document, for replacing it in place. */
  readonly pos: number
}

export interface ImageAction {
  readonly id: string
  readonly label: string
  appliesTo(src: string): boolean
  run(image: ImageRef): void
  /** The address to draw the image from; the Markdown keeps `src`. */
  displaySrc?(src: string): string
  /** Called when what `appliesTo` or `displaySrc` answer may have changed; returns the unsubscribe. */
  subscribe?(listener: () => void): () => void
}

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

class ImageActionsView implements NodeView {
  readonly dom: HTMLElement
  private readonly image: HTMLImageElement
  private readonly bar: HTMLElement
  private readonly unsubscribe: readonly (() => void)[]
  private readonly getPos: () => number | undefined
  private readonly actions: readonly ImageAction[]
  private node: PMNode

  constructor(node: PMNode, getPos: () => number | undefined, actions: readonly ImageAction[]) {
    this.node = node
    this.getPos = getPos
    this.actions = actions
    this.dom = document.createElement('span')
    this.dom.className = 'image-actions'
    this.image = document.createElement('img')
    this.bar = document.createElement('span')
    this.bar.className = 'image-actions-bar'
    this.bar.contentEditable = 'false'
    this.dom.append(this.image, this.bar)
    this.unsubscribe = actions.flatMap((action) =>
      action.subscribe === undefined ? [] : [action.subscribe(() => this.render())],
    )
    this.render()
  }

  private render(): void {
    const src = text(this.node.attrs['src']) ?? ''
    const shown = this.actions.reduce(
      (current, action) => action.displaySrc?.(current) ?? current,
      src,
    )
    if (this.image.getAttribute('src') !== shown) this.image.setAttribute('src', shown)
    const alt = text(this.node.attrs['alt'])
    const title = text(this.node.attrs['title'])
    this.image.setAttribute('alt', alt ?? '')
    if (title === null) this.image.removeAttribute('title')
    else this.image.setAttribute('title', title)

    const applying = this.actions.filter((action) => action.appliesTo(src))
    this.bar.replaceChildren(
      ...applying.map((action) => {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'image-actions-button'
        button.textContent = action.label
        button.dataset['action'] = action.id
        button.addEventListener('click', () => {
          const pos = this.getPos()
          if (pos === undefined) return
          action.run({ src, alt, title, pos })
        })
        return button
      }),
    )
    this.bar.hidden = applying.length === 0
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    this.render()
    return true
  }

  /** The buttons are the view's own; the editor neither selects nor edits through them. */
  stopEvent(event: Event): boolean {
    return event.target instanceof Node && this.bar.contains(event.target)
  }

  ignoreMutation(): boolean {
    return true
  }

  destroy(): void {
    for (const unsubscribe of this.unsubscribe) unsubscribe()
  }
}

/** Gives the Markdown package's `image` its view with actions, when there are any to offer. */
export function withImageActions(
  extensions: Extensions,
  actions: readonly ImageAction[],
): Extensions {
  if (actions.length === 0) return extensions
  const withView: Partial<NodeConfig> = {
    addNodeView:
      () =>
      ({ node, getPos }) =>
        new ImageActionsView(node, getPos, actions),
  }
  return extensions.map((extension) =>
    extension.type === 'node' && extension.name === 'image'
      ? extension.extend(withView)
      : extension,
  )
}

/**
 * Points the image at `pos` somewhere else, keeping its words: a diagram
 * saved as a copy takes the copy's address in place (ADR-043). False, and
 * nothing changes, when there is no image there any more.
 */
export function setImageSource(pos: number, src: string): Command {
  return (state, dispatch) => {
    const node = pos >= 0 && pos < state.doc.content.size ? state.doc.nodeAt(pos) : null
    if (node === null || node.type.name !== 'image') return false
    dispatch?.(state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, src }))
    return true
  }
}
