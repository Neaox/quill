import { codeBlockStyles } from '@quill/ui'
import type { Extensions, NodeConfig } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import type { EditorView as ProseMirrorView, NodeView } from '@tiptap/pm/view'

import { tv } from 'tailwind-variants'

import { renderAttribute } from '../schema/attributes.ts'
import { createCodeMirror, textChange } from './code-mirror.ts'
import type { CodeMirrorHost, EscapeDirection } from './code-mirror.ts'
import { LANGUAGES, resolveLanguage } from './languages.ts'

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
 * framed with, so the two cannot drift. What differs is what sits inside the
 * frame — a live editor rather than a `<pre>` — and what sits in the caption
 * strip: a picker that changes the block's language, and a copy action.
 */

/**
 * The parts of the chrome the design system does not own: the picker and the
 * copy action in the caption strip, and the host CodeMirror mounts into. The
 * node view is plain DOM rather than JSX, but the rule is the same — classes are
 * written once here, and a state is an attribute the stylesheet follows, never a
 * string assembled at render time.
 */
const chrome = tv({
  slots: {
    picker: [
      'code-block-language -ms-1 max-w-48 truncate rounded-sm border border-transparent',
      'bg-transparent px-1 py-0.5 text-2xs tracking-caps text-muted uppercase',
      'transition-colors ease-standard hover:border-border hover:text-foreground',
      'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring',
    ],
    copy: [
      'code-block-copy inline-flex items-center gap-1 rounded-sm border border-transparent',
      'px-1.5 py-0.5 text-2xs tracking-caps text-muted uppercase',
      'transition-colors ease-standard hover:border-border hover:text-foreground',
      'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring',
      'data-copied:text-success',
    ],
    editor: 'code-block-editor',
  },
})

const frame = codeBlockStyles()
const styles = chrome()

/** What the picker offers before any language: a fence with no name. */
export const PLAIN_TEXT = { value: '', label: 'Plain text' } as const

/** How long the copy action says it worked before going back to offering itself. */
export const COPIED_FEEDBACK_MS = 2000

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
): HTMLElementTagNameMap[K] {
  const created = document.createElement(tag)
  created.className = className
  return created
}

/** The copy glyph of `packages/ui`'s icon set, drawn where there is no React. */
function copyIcon(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '1.5')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')
  svg.setAttribute('class', 'size-3.5 shrink-0')
  const box = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  box.setAttribute('x', '5.75')
  box.setAttribute('y', '5.75')
  box.setAttribute('width', '7.5')
  box.setAttribute('height', '7.5')
  box.setAttribute('rx', '1.25')
  const sheet = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  sheet.setAttribute(
    'd',
    'M10.25 3.6A1.35 1.35 0 0 0 9 2.75H4A1.25 1.25 0 0 0 2.75 4v5c0 .58.37 1.08.85 1.25',
  )
  svg.append(box, sheet)
  return svg
}

function languagePicker(): HTMLSelectElement {
  const select = element('select', styles.picker())
  select.setAttribute('aria-label', 'Code block language')
  for (const { value, label } of [
    PLAIN_TEXT,
    ...LANGUAGES.map((language) => ({ value: language.id, label: language.label })),
  ]) {
    const option = document.createElement('option')
    option.value = value
    option.textContent = label
    select.append(option)
  }
  return select
}

export class CodeBlockNodeView implements NodeView {
  readonly dom: HTMLElement
  private node: PMNode
  private readonly view: ProseMirrorView
  private readonly getPos: () => number | undefined
  private readonly picker: HTMLSelectElement
  private readonly copy: HTMLButtonElement
  private readonly copyLabel: HTMLElement
  private readonly host: CodeMirrorHost
  /** Set while a change is travelling one way, so it does not come back. */
  private updating = false
  private copiedTimer: ReturnType<typeof setTimeout> | undefined

  constructor(node: PMNode, view: ProseMirrorView, getPos: () => number | undefined) {
    this.node = node
    this.view = view
    this.getPos = getPos

    this.dom = element('figure', frame.root({ className: 'code-block' }))

    const caption = element('figcaption', frame.caption())
    caption.contentEditable = 'false'

    this.picker = languagePicker()
    this.picker.addEventListener('change', () => {
      this.setLanguage(this.picker.value)
    })

    this.copyLabel = element('span', '')
    this.copyLabel.textContent = 'Copy'
    this.copy = element('button', styles.copy())
    this.copy.type = 'button'
    this.copy.contentEditable = 'false'
    this.copy.append(copyIcon(), this.copyLabel)
    this.copy.addEventListener('click', () => {
      void this.copyCode()
    })

    const actions = element('span', frame.actions())
    actions.append(this.copy)
    caption.append(this.picker, actions)

    const host = element('div', styles.editor())
    this.dom.append(caption, host)
    this.render()

    this.host = createCodeMirror({
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
    })
  }

  private languageName(): string {
    const language = this.node.attrs['language']
    return typeof language === 'string' ? language : PLAIN_TEXT.value
  }

  /** How the block is named to a screen reader, and in the picker. */
  private languageLabel(): string {
    const name = this.languageName()
    return resolveLanguage(name)?.label ?? (name === '' ? PLAIN_TEXT.label : name)
  }

  /**
   * What the picker shows, and how wide the block is.
   *
   * A known alias shows its canonical entry, so a block fenced `ts` reads as
   * TypeScript; a fence nothing knows keeps its own name as an option of its
   * own, because the document said it and the document wins. The width is the
   * block's `layout` attribute written as the grid reads it (ADR-027), which a
   * node view has to do for itself: replacing `toDOM` replaces the attributes
   * it would have rendered, and without them a `:::wide` block would quietly
   * snap back to the reading measure.
   */
  private render(): void {
    const name = this.languageName()
    const value = resolveLanguage(name)?.id ?? name
    const known = [...this.picker.options].some((option) => option.value === value)
    if (!known) {
      const option = document.createElement('option')
      option.value = value
      option.textContent = value
      this.picker.append(option)
    }
    this.picker.value = value
    this.dom.setAttribute('aria-label', `${this.languageLabel()} code block`)

    const layout = renderAttribute('layout', this.node.attrs['layout'])
    this.dom.removeAttribute('data-layout')
    for (const [attribute, written] of Object.entries(layout)) {
      this.dom.setAttribute(attribute, written)
    }
  }

  /**
   * The picker keeps the focus it has. A browser fires `change` on every arrow
   * key inside a closed select, so moving the caret into the code here would
   * take the picker away from a keyboard user on their first keystroke.
   */
  private setLanguage(name: string): void {
    const pos = this.getPos()
    if (pos === undefined) return
    const language = name === PLAIN_TEXT.value ? null : name
    this.view.dispatch(this.view.state.tr.setNodeAttribute(pos, 'language', language))
  }

  /**
   * Copy is the reading surface's action, offered where the code is written too.
   * A clipboard the browser refuses (an insecure origin, a denied permission)
   * leaves the button as it was rather than claiming something that did not
   * happen.
   */
  private async copyCode(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.node.textContent)
    } catch {
      return
    }
    this.copyLabel.textContent = 'Copied'
    this.copy.dataset['copied'] = 'true'
    clearTimeout(this.copiedTimer)
    this.copiedTimer = setTimeout(() => {
      this.copyLabel.textContent = 'Copy'
      delete this.copy.dataset['copied']
    }, COPIED_FEEDBACK_MS)
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

  private escape(direction: EscapeDirection): void {
    const pos = this.getPos()
    if (pos === undefined) return
    const target = direction < 0 ? pos : pos + this.node.nodeSize
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
    clearTimeout(this.copiedTimer)
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
