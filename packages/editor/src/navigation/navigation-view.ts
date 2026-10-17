import { renderTableOfContents, tableOfContentsEntries } from '@quill/markdown'
import type { ChildPagesBlock, ChildPagesQuery, TableOfContents } from '@quill/markdown'
import { buttonClassName, tv } from '@quill/ui'
import type { PopoverAnchor } from '@quill/ui'
import type { Node as PMNode } from '@tiptap/pm/model'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import type { Decoration, EditorView, NodeView } from '@tiptap/pm/view'
import { createElement } from 'react'
import type { ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'

import { childPagesOf, setNavigationBlock, tableOfContentsOf } from './navigation-commands.ts'
import type { NavigationBlockName } from './navigation-commands.ts'
import { isNavigationOutlineSpec } from './navigation-outline.ts'
import type { EditorHeading } from './navigation-outline.ts'
import {
  ChildPagesSettings,
  NavigationSettingsPanel,
  TableOfContentsSettings,
} from './navigation-settings.tsx'

/**
 * A navigation block as the author meets it (ADR-056): a live preview of
 * what a reader will be shown, drawn by the reader's own template, and a
 * Settings button opening a panel of the block's options. The whole block is
 * the view's — its label is written from the panel — so ProseMirror treats
 * it as one thing to select, move and delete.
 */

/** What lists a page's children for the preview: the application's, which owns the request. */
export type ChildPagesPreview = (
  query: ChildPagesQuery,
  signal: AbortSignal,
) => Promise<{ readonly html: string; readonly count: number }>

export interface NavigationViewOptions {
  /** Omitted, a child pages block says in words what it will list. */
  readonly childPages?: ChildPagesPreview | undefined
}

const block = tv({
  slots: {
    root: [
      'navigation-block my-2 rounded-lg border border-dashed border-border-strong/60 px-3 pt-2 pb-3',
      'data-[selected=true]:outline-2 data-[selected=true]:outline-offset-2 data-[selected=true]:outline-focus-ring',
    ],
    header: 'mb-2 flex items-center justify-between gap-2',
    name: 'text-xs font-medium tracking-wide text-muted uppercase',
    preview: 'navigation-block-preview',
    note: 'm-0 text-sm text-muted',
  },
})()

let blocks = 0

const NAMES: Readonly<Record<NavigationBlockName, string>> = {
  toc: 'Table of contents',
  children: 'Child pages',
}

function paragraph(className: string, words: string): HTMLParagraphElement {
  const created = document.createElement('p')
  created.className = className
  created.textContent = words
  return created
}

function describeChildPages(model: ChildPagesBlock): string {
  const levels = model.depth === 1 ? 'one level' : `${String(model.depth)} levels`
  const order =
    model.sort === 'manual'
      ? 'in the navigation’s order'
      : model.sort === 'title'
        ? 'by title'
        : 'most recently updated first'
  return `The pages under this one, ${levels} deep, ${order}, are listed here.`
}

export class NavigationBlockView implements NodeView {
  readonly dom: HTMLElement
  private node: PMNode
  private readonly name: NavigationBlockName
  private readonly view: EditorView
  private readonly getPos: () => number | undefined
  private readonly options: NavigationViewOptions
  private readonly settings: HTMLButtonElement
  private readonly preview: HTMLElement
  private readonly panel: Root
  private readonly ordinal: number
  private headings: readonly EditorHeading[] = []
  private signature: string | undefined
  private drawn: string | undefined
  private open = false
  private loading: AbortController | undefined

  constructor(
    node: PMNode,
    name: NavigationBlockName,
    view: EditorView,
    getPos: () => number | undefined,
    decorations: readonly Decoration[],
    options: NavigationViewOptions,
  ) {
    this.node = node
    this.name = name
    this.view = view
    this.getPos = getPos
    this.options = options
    this.ordinal = blocks += 1

    this.dom = document.createElement('div')
    this.dom.className = block.root()
    this.dom.contentEditable = 'false'
    this.dom.dataset['navigation'] = name
    this.dom.setAttribute('role', 'group')
    this.dom.setAttribute('aria-label', `${NAMES[name]} block`)

    const header = document.createElement('div')
    header.className = block.header()
    const label = document.createElement('span')
    label.className = block.name()
    label.textContent = NAMES[name]
    this.settings = document.createElement('button')
    this.settings.type = 'button'
    this.settings.className = buttonClassName({ variant: 'ghost', size: 'sm' })
    this.settings.textContent = 'Settings'
    this.settings.setAttribute('aria-label', `${NAMES[name]} settings`)
    this.settings.setAttribute('aria-haspopup', 'dialog')
    this.settings.setAttribute('aria-expanded', 'false')
    this.settings.addEventListener('click', () => {
      this.setOpen(!this.open)
    })
    header.append(label, this.settings)

    this.preview = document.createElement('div')
    this.preview.className = block.preview()
    this.preview.addEventListener('click', (event) => {
      this.follow(event)
    })

    // A press anywhere else on the block selects the block, as a press on an
    // image does: there is no text in it to put a caret in.
    this.dom.addEventListener('mousedown', (event) => {
      if (this.isControl(event.target)) return
      event.preventDefault()
      this.select()
    })

    const host = document.createElement('div')
    this.panel = createRoot(host)
    this.dom.append(header, this.preview, host)
    this.readOutline(decorations)
    this.render()
  }

  private readOutline(decorations: readonly Decoration[]): void {
    const specs: unknown[] = decorations.map((decoration) => decoration.spec)
    const spec = specs.find(isNavigationOutlineSpec)
    this.headings = spec?.headings ?? []
    this.signature = spec?.signature
  }

  private setOpen(open: boolean): void {
    this.open = open
    this.settings.setAttribute('aria-expanded', String(open))
    this.renderPanel()
  }

  private anchor(): PopoverAnchor {
    const box = this.settings.getBoundingClientRect()
    return { x: box.x, y: box.y, width: box.width, height: box.height }
  }

  private write(model: TableOfContents | ChildPagesBlock): void {
    const pos = this.getPos()
    /* v8 ignore next -- a view that has been taken out of the document has no settings open. */
    if (pos === undefined) return
    setNavigationBlock(pos, model)(this.view.state, this.view.dispatch)
  }

  private renderPanel(): void {
    const form: ReactElement =
      this.name === 'toc'
        ? createElement(TableOfContentsSettings, {
            model: tableOfContentsOf(this.node),
            onChange: (model: TableOfContents) => {
              this.write(model)
            },
          })
        : createElement(ChildPagesSettings, {
            model: childPagesOf(this.node),
            onChange: (model: ChildPagesBlock) => {
              this.write(model)
            },
          })
    this.panel.render(
      createElement(
        NavigationSettingsPanel,
        {
          open: this.open,
          anchor: this.anchor(),
          boundary: this.settings.closest('main'),
          label: `${NAMES[this.name]} settings`,
          onOpenChange: (open: boolean) => {
            this.setOpen(open)
          },
          onCloseFocus: () => {
            this.settings.focus()
          },
        },
        form,
      ),
    )
  }

  private render(): void {
    // What decides the preview: the block's own Markdown, and for a table of
    // contents the headings it lists. Redrawn only when one of them changes.
    const key = JSON.stringify([
      this.node.attrs['attributes'],
      this.node.textContent,
      this.signature,
    ])
    if (key === this.drawn) return
    this.drawn = key
    if (this.name === 'toc') this.renderContents()
    else this.renderChildPages()
    if (this.open) this.renderPanel()
  }

  private renderContents(): void {
    const model = tableOfContentsOf(this.node)
    this.preview.innerHTML = renderTableOfContents(
      model,
      tableOfContentsEntries(this.headings, model.levels),
    )
    // One id per block on the page, so two previews never share one.
    const title = this.preview.querySelector('.toc-title')
    const nav = this.preview.querySelector('nav')
    if (title !== null && nav !== null) {
      title.id = `editor-toc-${String(this.ordinal)}`
      nav.setAttribute('aria-labelledby', title.id)
    }
  }

  private renderChildPages(): void {
    const model = childPagesOf(this.node)
    this.loading?.abort()
    const section = document.createElement('section')
    section.className = 'child-pages'
    section.setAttribute('aria-label', 'Child pages preview')
    if (model.title !== undefined) section.append(paragraph('child-pages-title', model.title))
    const note = paragraph('child-pages-fallback', describeChildPages(model))
    section.append(note)
    this.preview.replaceChildren(section)
    const load = this.options.childPages
    if (load === undefined) return
    const loading = new AbortController()
    this.loading = loading
    section.setAttribute('aria-busy', 'true')
    load(model, loading.signal)
      .then(({ html }) => {
        if (loading.signal.aborted) return
        note.remove()
        section.insertAdjacentHTML('beforeend', html)
      })
      .catch(() => {
        // The words stay: they say what will be listed, which is still true.
      })
      .finally(() => {
        section.removeAttribute('aria-busy')
      })
  }

  /**
   * A link in the preview goes to its heading in the editor, not to a page
   * address: the caret is put at the start of the heading it names.
   */
  private follow(event: MouseEvent): void {
    /* v8 ignore next -- a press always lands on an element; a text node never receives one. */
    if (!(event.target instanceof Element)) return
    const link = event.target.closest('a')
    if (link === null) return
    event.preventDefault()
    if (this.name !== 'toc') return
    const id = decodeURIComponent(link.hash.slice(1))
    const heading = this.headings.find((candidate) => candidate.id === id)
    /* v8 ignore next -- every entry is drawn from these headings, in the same render. */
    if (heading === undefined) return
    const selection = TextSelection.near(this.view.state.doc.resolve(heading.pos + 1))
    this.view.dispatch(this.view.state.tr.setSelection(selection).scrollIntoView())
    this.view.focus()
  }

  update(node: PMNode, decorations: readonly Decoration[]): boolean {
    if (node.type !== this.node.type || node.attrs['name'] !== this.node.attrs['name']) return false
    this.node = node
    this.readOutline(decorations)
    this.render()
    return true
  }

  selectNode(): void {
    this.dom.dataset['selected'] = 'true'
  }

  deselectNode(): void {
    this.dom.dataset['selected'] = 'false'
  }

  private isControl(target: EventTarget | null): boolean {
    return (
      target instanceof Element && (this.settings.contains(target) || target.closest('a') !== null)
    )
  }

  private select(): void {
    const pos = this.getPos()
    /* v8 ignore next -- a view that has been taken out of the document cannot be pressed. */
    if (pos === undefined) return
    this.view.dispatch(
      this.view.state.tr.setSelection(NodeSelection.create(this.view.state.doc, pos)),
    )
    this.view.focus()
  }

  /** Every press on the block is the view's: its controls, its links, and selecting it. */
  stopEvent(event: Event): boolean {
    return event.type.startsWith('mouse') || event.type === 'click'
  }

  /** Everything inside is drawn by the view; none of it is the document's text. */
  ignoreMutation(): boolean {
    return true
  }

  destroy(): void {
    this.loading?.abort()
    // Unmounted once ProseMirror, and so React, has finished the update that
    // destroyed the view.
    queueMicrotask(() => {
      this.panel.unmount()
    })
  }
}
