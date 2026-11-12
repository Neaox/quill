import type { Extensions, NodeConfig } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { NodeView } from '@tiptap/pm/view'

import { mathDom, renderMath } from '@quill/markdown/math'

/**
 * Math as the writer meets it (ADR-064): the formula the reader will see,
 * drawn from the same engine and the same tree through `@quill/markdown/math`.
 * The atom's TeX is its `value`; the view is not editable, and a formula that
 * is not valid TeX shows what the reading surface shows — the source, and one
 * line saying what is wrong.
 */
export class MathNodeView implements NodeView {
  readonly dom: HTMLElement
  private node: PMNode

  constructor(node: PMNode) {
    this.node = node
    this.dom = document.createElement(node.type.name === 'mathBlock' ? 'div' : 'span')
    this.dom.contentEditable = 'false'
    this.dom.className = 'math'
    this.draw()
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false
    if (node.attrs['value'] === this.node.attrs['value']) return true
    this.node = node
    this.draw()
    return true
  }

  /** The formula's DOM is the view's own; ProseMirror should not read it as content. */
  ignoreMutation(): boolean {
    return true
  }

  private draw(): void {
    const display = this.node.type.name === 'mathBlock'
    const tex = String(this.node.attrs['value'] ?? '')
    this.dom.dataset['math'] = display ? 'display' : 'inline'
    this.dom.replaceChildren()

    const rendering = renderMath(tex, display)
    this.dom.classList.toggle('math-error', rendering.kind === 'error')
    if (rendering.kind === 'math') {
      this.dom.append(mathDom(rendering.math, document))
      return
    }

    const reason = `Invalid math: ${rendering.message}`
    const source = document.createElement('code')
    source.title = reason
    source.textContent = tex
    if (display) {
      const pre = document.createElement('pre')
      pre.append(source)
      const message = document.createElement('span')
      message.className = 'math-error-message'
      message.textContent = reason
      this.dom.append(pre, message)
      return
    }
    const message = document.createElement('span')
    message.className = 'sr-only'
    message.textContent = reason
    this.dom.append(source, message)
  }
}

const withView: Partial<NodeConfig> = {
  addNodeView:
    () =>
    ({ node }) =>
      new MathNodeView(node),
}

/** Gives both math atoms the reader's drawing of them while the author writes. */
export function withMathView(extensions: Extensions): Extensions {
  return extensions.map((extension) =>
    extension.type === 'node' && (extension.name === 'mathInline' || extension.name === 'mathBlock')
      ? extension.extend(withView)
      : extension,
  )
}
