import { readTableOptions, tableBlockData } from '@quill/markdown'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { EditorView, NodeView, ViewMutationRecord } from '@tiptap/pm/view'
import { TableMap } from 'prosemirror-tables'

import { wrapperAttributes } from './table-context.ts'
import { TableHandles } from './table-handles.ts'

/**
 * Tables as the author writes them (ADR-040, phase 2), drawn as a reader
 * sees them: the `:::table` wrapper is the card with its options as data
 * attributes, exactly as the renderer writes them (`tableBlockData`), and
 * the table scrolls sideways in its own scroller with its proportional
 * columns as a `<colgroup>`. A bare table is its own card.
 *
 * The handles (`table-handles.ts`) live in the table's view, outside its
 * editable content, so nothing ProseMirror owns is ever touched by them.
 */

/** The table views by their table element, so a wrapper can tell its table about its columns. */
const views = new WeakMap<Element, TableView>()

/** The column shares the wrapper sets, as percentages; undefined when it sets none. */
export function sharesOf(
  attributes: Readonly<Record<string, string>>,
  width: number,
): number[] | undefined {
  const columns = readTableOptions(attributes).options.columns
  if (columns === undefined || columns.length !== width) return undefined
  const total = columns.reduce((sum, each) => sum + each, 0)
  return columns.map((each) => (each / total) * 100)
}

function setData(element: HTMLElement, data: Readonly<Record<string, string>>): void {
  for (const name of element.getAttributeNames()) {
    if (name.startsWith('data-') && !(name in data) && name !== 'data-editor') {
      element.removeAttribute(name)
    }
  }
  for (const [name, value] of Object.entries(data)) element.setAttribute(name, value)
}

/** The `:::table` wrapper: the card, with the reading options the stylesheet reads. */
export class TableBlockView implements NodeView {
  readonly dom: HTMLElement
  readonly contentDOM: HTMLElement
  private node: PMNode

  constructor(node: PMNode) {
    this.node = node
    this.dom = document.createElement('div')
    this.dom.className = 'table-block table-block-editor'
    this.dom.dataset['editor'] = 'true'
    this.contentDOM = this.dom
    this.render()
  }

  private render(): void {
    const attributes = wrapperAttributes(this.node)
    setData(this.dom, tableBlockData(readTableOptions(attributes).options))
    // The table inside draws the columns; it is told when they change.
    const table = this.dom.querySelector(':scope > .table-editor')
    if (table !== null) views.get(table)?.setAttributes(attributes)
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type || node.attrs['name'] !== 'table') return false
    this.node = node
    this.render()
    return true
  }
}

/** A table: its scroller, its column group and its handles around the editable rows. */
export class TableView implements NodeView {
  readonly dom: HTMLElement
  readonly contentDOM: HTMLElement
  private readonly table: HTMLTableElement
  private readonly colgroup: HTMLTableColElement
  private readonly handles: TableHandles
  private node: PMNode
  private attributes: Readonly<Record<string, string>> = {}

  private readonly getPos: () => number | undefined

  constructor(node: PMNode, view: EditorView, getPos: () => number | undefined) {
    this.getPos = getPos
    this.node = node
    this.dom = document.createElement('div')
    this.dom.className = 'table-editor'
    const scroller = document.createElement('div')
    scroller.className = 'table-scroll'
    this.table = document.createElement('table')
    this.colgroup = document.createElement('colgroup')
    this.contentDOM = document.createElement('tbody')
    this.table.append(this.colgroup, this.contentDOM)
    scroller.append(this.table)
    this.handles = new TableHandles(view, () => this.position(), scroller, this.table)
    this.dom.append(scroller, this.handles.layer)
    views.set(this.dom, this)
    const pos = getPos()
    const parent = pos === undefined ? null : view.state.doc.resolve(pos).parent
    const wrapped = parent?.type.name === 'containerDirective' && parent.attrs['name'] === 'table'
    // A bare table is its own card; a wrapped one sits in its wrapper's.
    if (!wrapped) this.dom.classList.add('table-block', 'table-block-editor')
    this.attributes = wrapped && parent !== null ? wrapperAttributes(parent) : {}
    this.render()
  }

  private position(): number | undefined {
    return this.getPos()
  }

  /** Told by the wrapper when its attributes change. */
  setAttributes(attributes: Readonly<Record<string, string>>): void {
    this.attributes = attributes
    this.render()
  }

  private render(): void {
    // A `:::wide` or `:::full` around the table is its width (ADR-027), on the grid child.
    const layout: unknown = this.node.attrs['layout']
    if (typeof layout === 'string') this.dom.dataset['layout'] = layout
    else delete this.dom.dataset['layout']
    const map = TableMap.get(this.node)
    const shares = sharesOf(this.attributes, map.width)
    const cols = Array.from({ length: shares === undefined ? 0 : map.width }, (_, index) => {
      const col = document.createElement('col')
      col.style.width = `${shares?.[index] ?? 0}%`
      return col
    })
    this.colgroup.replaceChildren(...cols)
    this.table.classList.toggle('table-proportional', shares !== undefined)
    this.handles.render(this.node)
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    this.render()
    return true
  }

  /** The handles are the view's own; events on them are not ProseMirror's. */
  stopEvent(event: Event): boolean {
    return event.target instanceof Node && this.handles.layer.contains(event.target)
  }

  ignoreMutation(mutation: ViewMutationRecord): boolean {
    return !this.contentDOM.contains(mutation.target)
  }

  destroy(): void {
    this.handles.destroy()
    views.delete(this.dom)
  }
}
