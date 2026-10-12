import type { Extensions, NodeConfig } from '@tiptap/core'
import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { Command } from '@tiptap/pm/state'
import type { EditorView, NodeView } from '@tiptap/pm/view'

import type { EditorView as CodeMirrorView } from '@codemirror/view'
import { revealTab } from '@quill/design-css/code-blocks'
import { createCopyButton } from '@quill/design-css/copy'
import type { CopyButton } from '@quill/design-css/copy'
import { tv } from 'tailwind-variants'

import { CODE_SELECTION_EVENT } from './code-block-view.ts'
import {
  addTab,
  moveTab,
  removeTab,
  renameTab,
  setTabLanguage,
  tabName,
} from './code-group-commands.ts'
import type { LanguageField } from './language-field.ts'
import { codeMirrorSource, createLanguageField, languageName } from './language-field.ts'
import { codeMirrorIn } from './lazy-code-mirror.ts'

/**
 * A code group in the editor (ADR-041): its tabs across the top, the tab on
 * show beneath, each tab an ordinary code block with its own language field
 * and copy button.
 *
 * The tabs are the reader's tabs, worked the reader's way — arrow keys, Home
 * and End, one tab stop — and an author's besides:
 *
 * - **Add** with the button at the end of the strip; the new tab opens with
 *   the caret in it.
 * - **Rename** by double-clicking a tab or pressing F2: the name is edited in
 *   place, Enter keeps it and Escape puts it back. An empty name hands the tab
 *   back to its language's name.
 * - **Remove** with the cross on a tab, or Delete. Removing the last tab
 *   removes the group.
 * - **Reorder** by dragging a tab, or with Alt and an arrow key.
 *
 * Every change is one ProseMirror transaction (`code-group-commands.ts`), so
 * undo and redo take each one back whole, and every one puts the selection in
 * the tab it changed, which is how undo shows the tab it restores. Choosing a
 * tab is not a change to the document at all: it moves nothing, so the caret
 * never jumps and the keyboard stays where it was.
 */

const styles = tv({
  slots: {
    root: [
      'code-group-editor my-0 overflow-hidden rounded-lg border border-border bg-code-background',
      // The tabs are the group's caption; each block's own frame gives way to the group's.
      '[&_.code-block]:rounded-none [&_.code-block]:border-0',
    ],
    header: 'flex min-w-0 items-stretch gap-1 border-b border-border pe-1.5',
    strip: [
      'code-group-tabs flex min-w-0 flex-1 overflow-x-auto overflow-y-hidden overscroll-x-contain',
      // Many tabs scroll sideways on the page's thin, blended scrollbar.
      '[scrollbar-width:thin]',
    ],
    tab: [
      'group/tab relative inline-flex flex-none cursor-pointer items-center gap-1.5 px-3.5 py-2.5',
      'text-xs font-medium whitespace-nowrap text-muted select-none',
      'transition-colors ease-standard hover:text-foreground',
      'aria-selected:font-semibold aria-selected:text-foreground',
      'after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-t-sm',
      'aria-selected:after:bg-accent',
      'focus-visible:rounded-sm focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring',
      'data-[drop=before]:shadow-[inset_2px_0_0_var(--color-accent)]',
      'data-[drop=after]:shadow-[inset_-2px_0_0_var(--color-accent)]',
      'data-dragging:opacity-50',
    ],
    remove: [
      'grid size-4 place-items-center rounded-sm text-muted opacity-0',
      'group-hover/tab:opacity-100 group-aria-selected/tab:opacity-100 hover:bg-border hover:text-foreground',
    ],
    rename: [
      'my-1.5 ms-1.5 w-32 min-w-0 rounded-sm border border-border bg-background px-1.5 py-0.5',
      'text-xs font-semibold text-foreground',
      'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring',
    ],
    add: [
      'my-1 inline-flex flex-none items-center gap-1 rounded-sm px-2 text-xs font-medium text-muted',
      'transition-colors ease-standard hover:bg-border/60 hover:text-foreground',
      'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring',
    ],
    panels: 'code-group-panels',
    tools: 'code-block-toolbar flex flex-none items-center gap-1',
    help: 'sr-only',
  },
})

const style = styles()

const CROSS =
  '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>'
const PLUS =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path d="M8 3.5v9M3.5 8h9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>'

/** What the keyboard can do on a tab, said once for a screen reader. */
export const TAB_HELP =
  'Arrow keys choose a tab. F2 or a double click renames it, Delete removes it, and Alt with an arrow key moves it.'

let groupsMade = 0

/** The view for each group's element, so the selection watcher can find it. */
const views = new Map<Node | null, CodeGroupNodeView>()

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
): HTMLElementTagNameMap[K] {
  const created = document.createElement(tag)
  created.className = className
  return created
}

export class CodeGroupNodeView implements NodeView {
  readonly dom: HTMLElement
  readonly contentDOM: HTMLElement
  private node: PMNode
  private readonly view: EditorView
  private readonly getPos: () => number | undefined
  private readonly id: string
  private readonly strip: HTMLElement
  private active = 0
  private renaming: number | undefined
  private dragging: number | undefined
  private readonly field: LanguageField
  private readonly copy: CopyButton

  constructor(node: PMNode, view: EditorView, getPos: () => number | undefined) {
    this.node = node
    this.view = view
    this.getPos = getPos
    groupsMade += 1
    this.id = `code-group-editor-${groupsMade}`

    this.dom = element('div', style.root())
    this.dom.setAttribute('role', 'group')
    this.dom.setAttribute('aria-label', 'Code group')

    const header = element('div', style.header())
    header.contentEditable = 'false'
    this.strip = element('div', style.strip())
    this.strip.setAttribute('role', 'tablist')
    this.strip.setAttribute('aria-label', 'Code group tabs')
    const help = element('span', style.help())
    help.id = `${this.id}-help`
    help.textContent = TAB_HELP
    this.strip.setAttribute('aria-describedby', help.id)

    const add = element('button', style.add())
    add.type = 'button'
    add.innerHTML = PLUS
    add.append('Add tab')
    add.addEventListener('click', () => {
      this.addTab()
    })
    // The tab on show's language and copy button: a tab is a code block whose
    // own tools give way to the strip's, so its code starts under the tabs.
    this.field = createLanguageField({
      commit: (name) => this.run((pos) => setTabLanguage(pos, this.active, name)),
      cancel: () => {
        this.focusCode(this.active)
      },
    })
    this.copy = createCopyButton(document, {
      source: codeMirrorSource(() => this.editorOf(this.active)),
    })
    const tools = element('div', style.tools())
    tools.append(this.field.element, this.copy.element)
    header.append(this.strip, tools, add, help)

    this.contentDOM = element('div', style.panels())
    this.contentDOM.addEventListener(CODE_SELECTION_EVENT, () => {
      const selection = this.editorOf(this.active)?.state.selection.main
      this.copy.setMode(selection === undefined || selection.empty ? 'code' : 'selection')
    })
    this.dom.append(header, this.contentDOM)
    this.listen()
    views.set(this.dom, this)
    this.render()
  }

  /** Where the group is, which every command acts at. */
  private run(command: (pos: number) => Command): boolean {
    const pos = this.getPos()
    if (pos === undefined) return false
    return command(pos)(this.view.state, this.view.dispatch)
  }

  private tabs(): HTMLElement[] {
    return [...this.strip.querySelectorAll<HTMLElement>('[role="tab"]')]
  }

  /** The tab an event happened on or in, by its place; -1 when it was not on one. */
  private indexOf(event: Event): number {
    const path = event.composedPath()
    // Inside the rename field, keys and clicks edit its text: they are not the strip's.
    if (path.some((target) => target instanceof HTMLInputElement)) return -1
    return this.tabs().findIndex((tab) => path.includes(tab))
  }

  /** The tab strip, drawn again from the group; the tab that had the focus keeps it. */
  private render(): void {
    const focused = this.tabs().findIndex((tab) => tab === document.activeElement)
    this.active = Math.min(this.active, this.node.childCount - 1)
    const tabs: HTMLElement[] = []
    this.node.forEach((block, _offset, index) => {
      tabs.push(this.renaming === index ? this.renameField(block, index) : this.tab(block, index))
    })
    this.strip.replaceChildren(...tabs)
    this.show()
    if (focused !== -1) this.tabs()[Math.min(focused, tabs.length - 1)]?.focus()
  }

  private tab(block: PMNode, index: number): HTMLElement {
    const name = tabName(block, index)
    const tab = element('div', style.tab())
    tab.id = `${this.id}-tab-${index}`
    tab.setAttribute('role', 'tab')
    tab.draggable = true
    tab.dataset['index'] = String(index)
    tab.title = name
    const label = document.createElement('span')
    label.textContent = name
    const remove = element('span', style.remove())
    remove.setAttribute('aria-hidden', 'true')
    remove.dataset['action'] = 'remove'
    remove.title = `Remove ${name}`
    remove.innerHTML = CROSS
    tab.append(label, remove)
    return tab
  }

  /**
   * The field a tab is renamed in, inside the tab it renames: a tablist holds
   * only tabs, and the panel stays labelled by its tab while it is renamed.
   */
  private renameField(block: PMNode, index: number): HTMLElement {
    const tab = document.createElement('div')
    tab.id = `${this.id}-tab-${index}`
    tab.setAttribute('role', 'tab')
    const field = element('input', style.rename())
    tab.append(field)
    field.type = 'text'
    field.value = tabName(block, index)
    field.setAttribute('aria-label', 'Tab name')
    let settled = false
    const finish = (keep: boolean): void => {
      if (settled) return
      settled = true
      this.renaming = undefined
      const name = field.value
      if (!keep || !this.run((pos) => renameTab(pos, index, name))) this.render()
      this.tabs()[index]?.focus()
    }
    field.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        finish(true)
      } else if (event.key === 'Escape') {
        event.preventDefault()
        finish(false)
      }
    })
    field.addEventListener('blur', () => {
      finish(true)
    })
    return tab
  }

  /**
   * Marks the chosen tab, and shows its panel and only its panel. Run again
   * once ProseMirror has drawn the panels (`CodeGroupReveal`), because a node
   * view is built, and updated, before its content is.
   */
  show(): void {
    const block = this.node.maybeChild(this.active)
    this.field.show(block?.attrs['language'])
    this.copy.setLanguage(languageName(block?.attrs['language']))
    this.tabs().forEach((tab, index) => {
      const selected = index === this.active
      tab.setAttribute('aria-selected', String(selected))
      tab.tabIndex = selected ? 0 : -1
      tab.setAttribute('aria-controls', `${this.id}-panel-${index}`)
    })
    ;[...this.contentDOM.children].forEach((panel, index) => {
      panel.id = `${this.id}-panel-${index}`
      panel.setAttribute('role', 'tabpanel')
      panel.setAttribute('aria-labelledby', `${this.id}-tab-${index}`)
      panel.toggleAttribute('hidden', index !== this.active)
    })
  }

  /**
   * The CodeMirror editor of a tab. A tab not yet opened is opened, because
   * whatever asks — the copy button, the language field giving the focus
   * back — is the writer reaching for its code (`lazy-code-mirror.ts`).
   */
  private editorOf(index: number): CodeMirrorView | null {
    return codeMirrorIn(this.contentDOM.children[index])
  }

  /** Chooses a tab. Nothing in the document changes, so nothing jumps. */
  select(index: number, focus: 'tab' | 'code' | 'none' = 'none'): void {
    this.active = index
    this.show()
    for (const tab of this.tabs().slice(index, index + 1)) {
      revealTab(this.strip, tab)
      if (focus === 'tab') tab.focus()
    }
    if (focus === 'code') this.focusCode(index)
  }

  private focusCode(index: number): void {
    this.editorOf(index)?.focus()
  }

  private addTab(): void {
    const index = this.node.childCount
    if (!this.run(addTab)) return
    this.select(index, 'code')
  }

  private removeTab(index: number): void {
    const last = this.node.childCount === 1
    if (!this.run((pos) => removeTab(pos, index)) || last) return
    this.select(Math.min(index, this.node.childCount - 1), 'tab')
  }

  private moveTab(from: number, to: number): void {
    if (!this.run((pos) => moveTab(pos, from, to))) return
    this.select(to, 'tab')
  }

  private startRename(index: number): void {
    this.renaming = index
    this.render()
    const field = this.strip.querySelector('input')
    field?.focus()
    field?.select()
  }

  private listen(): void {
    this.strip.addEventListener('click', (event) => {
      const index = this.indexOf(event)
      if (index === -1) return
      const remove = this.strip.querySelectorAll('[data-action="remove"]')
      if ([...remove].some((cross) => event.composedPath().includes(cross))) {
        this.removeTab(index)
        return
      }
      this.select(index, 'tab')
    })
    this.strip.addEventListener('dblclick', (event) => {
      const index = this.indexOf(event)
      if (index !== -1) this.startRename(index)
    })
    this.strip.addEventListener('keydown', (event) => {
      this.onKey(event)
    })
    this.strip.addEventListener('dragstart', (event) => {
      this.dragging = this.indexOf(event)
      // jsdom, and nothing else, starts a drag with no data to carry.
      const transfer = event.dataTransfer
      if (transfer) {
        transfer.setData('text/plain', String(this.dragging))
        transfer.effectAllowed = 'move'
      }
      this.tabs()[this.dragging]?.setAttribute('data-dragging', '')
    })
    this.strip.addEventListener('dragover', (event) => {
      const index = this.indexOf(event)
      if (this.dragging === undefined || index === -1) return
      event.preventDefault()
      for (const tab of this.tabs()) delete tab.dataset['drop']
      const tab = this.tabs()[index]
      if (tab !== undefined && index !== this.dragging) {
        tab.dataset['drop'] = index < this.dragging ? 'before' : 'after'
      }
    })
    this.strip.addEventListener('drop', (event) => {
      const index = this.indexOf(event)
      const from = this.dragging
      this.endDrag()
      if (from === undefined || index === -1) return
      event.preventDefault()
      this.moveTab(from, index)
    })
    this.strip.addEventListener('dragend', () => {
      this.endDrag()
    })
  }

  private endDrag(): void {
    this.dragging = undefined
    for (const tab of this.tabs()) {
      delete tab.dataset['drop']
      tab.removeAttribute('data-dragging')
    }
  }

  private onKey(event: KeyboardEvent): void {
    const index = this.indexOf(event)
    if (index === -1) return
    const count = this.node.childCount
    const moves: Readonly<Record<string, number>> = {
      ArrowRight: (index + 1) % count,
      ArrowLeft: (index - 1 + count) % count,
      Home: 0,
      End: count - 1,
    }
    const target = moves[event.key]
    if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault()
      const to = event.key === 'ArrowLeft' ? index - 1 : index + 1
      if (to >= 0 && to < count) this.moveTab(index, to)
      return
    }
    if (target !== undefined) {
      event.preventDefault()
      this.select(target, 'tab')
    } else if (event.key === 'F2') {
      event.preventDefault()
      this.startRename(index)
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      this.removeTab(index)
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      this.select(index, 'code')
    }
  }

  /** Shows the tab holding the selection, when the selection was put there. */
  reveal(index: number): void {
    if (index === this.active) return
    const hadFocus = this.view.hasFocus() || this.dom.contains(document.activeElement)
    this.select(index, hadFocus ? 'code' : 'none')
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    this.render()
    return true
  }

  /** The strip is the view's own; ProseMirror handles only what happens in the panels. */
  stopEvent(event: Event): boolean {
    return !event.composedPath().includes(this.contentDOM)
  }

  /** The strip's own changes are the view's; the panels are ProseMirror's. */
  ignoreMutation(mutation: ViewMutationRecord): boolean {
    if (mutation.type === 'selection') return false
    return !this.contentDOM.contains(mutation.target)
  }

  destroy(): void {
    this.copy.dispose()
    this.field.destroy()
    views.delete(this.dom)
  }
}

type ViewMutationRecord = Parameters<NonNullable<NodeView['ignoreMutation']>>[0]

const revealKey = new PluginKey<number>('codeGroupReveal')

/**
 * Shows the tab the selection is put in — by the arrow keys, by a command,
 * by undo — and only when it is put there: a change typed into one tab while
 * the selection rests in another must not switch tabs under the writer.
 */
export const CodeGroupReveal = Extension.create({
  name: 'codeGroupReveal',
  addProseMirrorPlugins: () => [
    new Plugin<number>({
      key: revealKey,
      state: {
        init: () => 0,
        apply: (tr, moves) => (tr.selectionSet ? moves + 1 : moves),
      },
      view: () => {
        for (const each of views.values()) each.show()
        return {
          update(view, previous) {
            for (const each of views.values()) each.show()
            if (revealKey.getState(view.state) === revealKey.getState(previous)) return
            const { $from } = view.state.selection
            for (let depth = $from.depth; depth > 0; depth -= 1) {
              if ($from.node(depth).type.name !== 'codeGroup') continue
              views.get(view.nodeDOM($from.before(depth)))?.reveal($from.index(depth))
              return
            }
          },
        }
      },
    }),
  ],
})

const withView: Partial<NodeConfig> = {
  addNodeView:
    () =>
    ({ node, editor, getPos }) =>
      new CodeGroupNodeView(node, editor.view, getPos),
}

/** Gives the Markdown package's `codeGroup` its tabbed view. */
export function withCodeGroupView(extensions: Extensions): Extensions {
  return extensions.map((extension) =>
    extension.type === 'node' && extension.name === 'codeGroup'
      ? extension.extend(withView)
      : extension,
  )
}
