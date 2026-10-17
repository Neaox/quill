import { createCopyButton } from '@quill/design-css/copy'
import type { CopyButton } from '@quill/design-css/copy'
import { codeBlockStyles } from '@quill/ui'
import type { Extensions, NodeConfig } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import type { EditorView as ProseMirrorView, NodeView } from '@tiptap/pm/view'

import { tv } from 'tailwind-variants'

import { renderAttribute } from '../schema/attributes.ts'
import { textChange } from './code-mirror.ts'
import type { EscapeDirection } from './code-mirror.ts'
import { createLazyCodeMirror } from './lazy-code-mirror.ts'
import type { LazyCodeMirrorHost } from './lazy-code-mirror.ts'
import type { LanguageField } from './language-field.ts'
import {
  codeMirrorSource,
  createLanguageField,
  languageName,
  PLAIN_TEXT,
} from './language-field.ts'
import { resolveLanguage } from './languages.ts'

export { PLAIN_TEXT } from './language-field.ts'

/**
 * A code block, edited in CodeMirror (ADR-003).
 *
 * A plain ProseMirror node view rather than a React one, because the node has no
 * ProseMirror-managed content while CodeMirror holds it: the two editors would
 * otherwise render the same text twice. The block still behaves like a block —
 * the caret enters it from the document and leaves it again by arrow key, Escape
 * or Mod-Enter, so a keyboard user is never trapped in it.
 *
 * The frame is the reading surface's, literally: the classes come from
 * `codeBlockStyles` in the design system, which is what a published block is
 * framed with, and the code sits at the reading surface's padding, so a block
 * looks the same written as read. Its tools — a searchable language field and
 * the copy button a reader gets (`@quill/design-css/copy`, ADR-041) — sit in
 * the card's top corner, where the reader's copy button sits, rather than in a
 * row of their own above the code. A block that is a tab of a code group has
 * none: the group's tab strip carries them (`code-group-view.ts`).
 */

/** Selection changes in a block's code, told to the group around it. */
export const CODE_SELECTION_EVENT = 'code-block:selection'

const chrome = tv({
  slots: {
    toolbar: [
      'code-block-toolbar absolute end-1.5 top-1.5 z-10 flex items-center gap-1 rounded-md',
      'bg-code-background/90 ps-1',
    ],
    // The reading surface's padding (`.prose pre` in `@quill/design-css`), so
    // the first line sits where it does when the block is read.
    editor: 'code-block-editor [&_.cm-content]:py-3.5',
  },
})

const frame = codeBlockStyles()
const styles = chrome()

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
): HTMLElementTagNameMap[K] {
  const created = document.createElement(tag)
  created.className = className
  return created
}

export class CodeBlockNodeView implements NodeView {
  readonly dom: HTMLElement
  private node: PMNode
  private readonly view: ProseMirrorView
  private readonly getPos: () => number | undefined
  private readonly toolbar: HTMLElement
  private readonly field: LanguageField
  private readonly copy: CopyButton
  /** CodeMirror, built when the block comes near the screen or is reached for (`lazy-code-mirror.ts`). */
  private readonly host: LazyCodeMirrorHost
  /** Set while a change is travelling one way, so it does not come back. */
  private updating = false

  constructor(node: PMNode, view: ProseMirrorView, getPos: () => number | undefined) {
    this.node = node
    this.view = view
    this.getPos = getPos

    this.dom = element('figure', frame.root({ className: 'code-block relative' }))

    this.toolbar = element('div', styles.toolbar())
    this.toolbar.contentEditable = 'false'
    this.field = createLanguageField({
      commit: (name) => this.setLanguage(name),
      cancel: () => {
        this.host.view.focus()
      },
    })
    this.copy = createCopyButton(document, {
      source: codeMirrorSource(() => this.host.view),
    })
    this.toolbar.append(this.field.element, this.copy.element)

    const host = element('div', styles.editor())
    this.dom.append(this.toolbar, host)

    this.host = createLazyCodeMirror({
      parent: host,
      text: node.textContent,
      language: resolveLanguage(this.languageName()),
      editable: view.editable,
      onChange: (text) => {
        this.forwardChange(text)
      },
      onEscape: (direction) => {
        this.escape(direction)
      },
      onSelection: (empty) => {
        this.copy.setMode(empty ? 'code' : 'selection')
        this.dom.dispatchEvent(new Event(CODE_SELECTION_EVENT, { bubbles: true }))
      },
    })
    this.render()
  }

  private languageName(): string {
    const language = this.node.attrs['language']
    return typeof language === 'string' ? language : PLAIN_TEXT.value
  }

  /** Whether the block is a tab of a code group, whose strip carries its tools. */
  private inGroup(): boolean {
    const pos = this.getPos()
    return pos !== undefined && this.view.state.doc.resolve(pos).parent.type.name === 'codeGroup'
  }

  /**
   * What the tools show, and how wide the block is.
   *
   * A known alias shows its language's name, so a block fenced `ts` reads as
   * TypeScript; a fence nothing knows shows its own name, because the document
   * said it and the document wins. The width is the block's `layout` attribute
   * written as the grid reads it (ADR-027), which a node view has to do for
   * itself: replacing `toDOM` replaces the attributes it would have rendered,
   * and without them a `:::wide` block would quietly snap back to the reading
   * measure.
   */
  private render(): void {
    const label = languageName(this.node.attrs['language'])
    this.field.show(this.node.attrs['language'])
    this.dom.setAttribute('aria-label', `${label ?? PLAIN_TEXT.label} code block`)
    this.copy.setLanguage(label)
    this.toolbar.hidden = this.inGroup()

    const layout = renderAttribute('layout', this.node.attrs['layout'])
    this.dom.removeAttribute('data-layout')
    for (const [attribute, written] of Object.entries(layout)) {
      this.dom.setAttribute(attribute, written)
    }
  }

  /**
   * Writes a language onto the block. The field keeps the focus it has:
   * moving the caret into the code here would take the field away from a
   * keyboard user in the middle of choosing.
   */
  private setLanguage(name: string | null): boolean {
    const pos = this.getPos()
    if (pos === undefined) return false
    this.view.dispatch(this.view.state.tr.setNodeAttribute(pos, 'language', name))
    return true
  }

  /** CodeMirror changed; write the same change into the document. */
  private forwardChange(text: string): void {
    const pos = this.getPos()
    if (this.updating || pos === undefined) return
    const change = textChange(this.node.textContent, text)
    if (change === null) return
    const start = pos + 1
    const { state } = this.view
    const transaction =
      change.text.length === 0
        ? state.tr.delete(start + change.from, start + change.to)
        : state.tr.replaceWith(
            start + change.from,
            start + change.to,
            state.schema.text(change.text),
          )
    this.updating = true
    this.view.dispatch(transaction)
    this.updating = false
  }

  /**
   * Leaves the block for the document. A block that is a tab of a code group
   * leaves the group with it: the next block down is the next tab, which is
   * out of sight, and the writer meant the line after the group.
   */
  private escape(direction: EscapeDirection): void {
    const pos = this.getPos()
    if (pos === undefined) return
    const $pos = this.view.state.doc.resolve(pos)
    const inGroup = $pos.parent.type.name === 'codeGroup'
    const before = inGroup ? $pos.before() : pos
    const after = inGroup ? $pos.after() : pos + this.node.nodeSize
    const target = direction < 0 ? before : after
    const selection = TextSelection.near(this.view.state.doc.resolve(target), direction)
    this.view.dispatch(this.view.state.tr.setSelection(selection).scrollIntoView())
    this.view.focus()
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    this.render()
    this.host.setLanguage(resolveLanguage(this.languageName()))
    if (this.updating) return true
    this.updating = true
    this.host.setText(node.textContent)
    this.updating = false
    return true
  }

  setSelection(anchor: number, head: number): void {
    this.host.view.focus()
    this.host.view.dispatch({ selection: { anchor, head } })
  }

  /** CodeMirror owns everything inside it, including the events and the DOM. */
  stopEvent(): boolean {
    return true
  }

  ignoreMutation(): boolean {
    return true
  }

  destroy(): void {
    this.copy.dispose()
    this.field.destroy()
    this.host.destroy()
  }
}

const withView: Partial<NodeConfig> = {
  addNodeView:
    () =>
    ({ node, editor, getPos }) =>
      new CodeBlockNodeView(node, editor.view, getPos),
}

/** Gives the Markdown package's `codeBlock` its CodeMirror view. */
export function withCodeBlockView(extensions: Extensions): Extensions {
  return extensions.map((extension) =>
    extension.type === 'node' && extension.name === 'codeBlock'
      ? extension.extend(withView)
      : extension,
  )
}
