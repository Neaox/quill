import type { ClipboardWriter } from '../code-blocks/copy.ts'
import { announce, writeClipboard } from '../code-blocks/copy.ts'
import type { ResizeObserverClass } from '../viewer/viewer.ts'
import { hintFor, iconButton, openViewer, VIEWER_ICONS, viewerControl } from '../viewer/viewer.ts'
import { readTable, tableToCsv, tableToMarkdown } from './table-text.ts'

/**
 * A table, full screen (ADR-040): the same viewer a diagram opens in
 * (`../viewer/viewer.ts`).
 *
 * The table's own scroller is moved into the viewer and back again rather
 * than copied, so its sort state, its sort buttons and its ids stay single,
 * and a sort made in the viewer is still there when it closes. In the viewer
 * the stage is the one scroll container, on both axes, so the header row,
 * the frozen first column and the footer stick there in plain CSS
 * (`prose.css`, "Table viewer"). Tables scroll; they do not zoom. "Fit
 * width" shrinks the whole table to the stage's width, for a reader who asks.
 */

export interface TableViewerOptions {
  /** Defaults to the document's own `navigator.clipboard`, where there is one. */
  readonly clipboard?: ClipboardWriter | undefined
  /** The ResizeObserver the viewer watches its stage with; the window's own by default. */
  readonly ResizeObserver?: ResizeObserverClass | undefined
}

/** A table this much wider than the stage overflows it; less is rounding. */
const TOLERANCE = 2

const FIT_ICON =
  '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><path d="M2.5 8h11M5 5.5 2.5 8 5 10.5M11 5.5l2.5 2.5-2.5 2.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'

/** The attributes the stylesheet reads off a table block, carried onto its frame in the viewer. */
const CARRIED = ['data-freeze', 'data-headers', 'data-responsive', 'data-sort', 'data-caption']

function captionText(table: HTMLTableElement): string | null {
  const text = table.caption?.textContent.trim() ?? ''
  return text === '' ? null : text
}

/**
 * "Fit width" exists only while it can do something: while the table at its
 * own size is wider than the stage, or while it is fitted, when it offers the
 * way back ("Actual size"). A situational control is hidden, not disabled,
 * when it cannot act (`docs/design/feedback.md`, "Disable or hide"), and focus
 * never stays on one that has gone: it moves to the next control.
 *
 * Sizes are layout sizes: `scrollWidth` is the table's own width, unscaled by
 * the `zoom` that fits it, and `clientWidth` is the stage's.
 */
function fitWidth(
  button: HTMLButtonElement,
  next: HTMLElement,
  frame: HTMLElement,
  table: HTMLTableElement,
  stage: HTMLElement,
): { readonly sizeFit: () => void } {
  let fitting = false
  const scale = (): number => Math.min(1, stage.clientWidth / Math.max(1, table.scrollWidth))
  const set = (on: boolean): void => {
    fitting = on
    frame.style.setProperty('--table-fit', String(on ? scale() : 1))
    frame.toggleAttribute('data-fit', on)
    button.setAttribute('aria-label', on ? 'Actual size' : 'Fit width')
    button.dataset['state'] = on ? 'on' : 'off'
  }
  const sizeFit = (): void => {
    const overflows = table.scrollWidth > stage.clientWidth + TOLERANCE
    set(fitting && overflows)
    const shown = overflows
    if (!shown && button.ownerDocument.activeElement === button) next.focus()
    button.hidden = !shown
  }
  button.addEventListener('click', () => {
    set(!fitting)
  })
  sizeFit()
  return { sizeFit }
}

/** Gives a table block its expand button. Returns what takes it away again. */
export function addTableViewer(
  block: HTMLElement,
  scroller: HTMLElement,
  options: TableViewerOptions = {},
): () => void {
  const doc = block.ownerDocument
  const view = doc.defaultView
  const clipboard = options.clipboard ?? view?.navigator.clipboard
  const table = scroller.querySelector<HTMLTableElement>(':scope > table')
  /* v8 ignore next -- the enhancer only offers a block whose scroller holds a table. */
  if (table === null) return () => undefined
  const caption = captionText(table)
  const expand = iconButton(
    doc,
    'table-expand',
    caption === null ? 'Expand table' : `Expand table: ${caption}`,
    VIEWER_ICONS.expand,
  )
  let close: (() => void) | null = null

  const copyAs = (format: 'CSV' | 'Markdown', dialog: Element) => async (): Promise<void> => {
    const text = readTable(table)
    const written = await writeClipboard(
      format === 'CSV' ? tableToCsv(text) : tableToMarkdown(text),
      clipboard,
    )
    announce(
      doc,
      written ? `Table copied as ${format}` : 'The browser refused to copy the table',
      dialog,
    )
  }

  const open = (): void => {
    const frame = doc.createElement('div')
    frame.className = 'table-block'
    frame.dataset['enhanced'] = 'viewer'
    for (const name of CARRIED) {
      const value = block.getAttribute(name)
      if (value !== null) frame.setAttribute(name, value)
    }
    const fit = viewerControl(doc, 'fit', 'Fit width', FIT_ICON)
    // Named by the words they show, so a speech user can say what they see.
    const csv = viewerControl(doc, 'csv', 'Copy CSV', 'Copy CSV')
    const markdown = viewerControl(doc, 'markdown', 'Copy Markdown', 'Copy Markdown')
    for (const control of [csv, markdown]) control.classList.add('lightbox-text-control')

    // Measured where it sits: in the viewer it is not laid out until shown.
    const tableWidth = table.scrollWidth
    // The block keeps its height while its scroller is away, so the page
    // behind the viewer does not move.
    block.style.minHeight = `${block.getBoundingClientRect().height}px`
    const placeholder = doc.createComment('table in the viewer')
    scroller.replaceWith(placeholder)
    // The sort announcements go with the table: outside the open dialog the
    // page is inert, and an inert live region is never heard.
    const status = [...block.querySelectorAll<HTMLElement>(':scope > .table-announcement')]
    frame.append(scroller, ...status)

    const viewer = openViewer(doc, {
      label: caption ?? 'Table',
      caption,
      controls: [fit, csv, markdown],
      content: [frame],
      stageClass: 'lightbox-stage-table',
      hint: (device) =>
        hintFor(
          { ...device, wide: tableWidth > doc.documentElement.clientWidth },
          { pointer: '', touch: 'Swipe to scroll the table' },
        ),
      trigger: expand,
      onResize: () => {
        sizeFit()
      },
      ResizeObserver: options.ResizeObserver,
      onClose: () => {
        placeholder.replaceWith(scroller)
        block.append(...status)
        block.style.removeProperty('min-height')
        if (block.getAttribute('style') === '') block.removeAttribute('style')
        close = null
      },
    })
    csv.addEventListener('click', copyAs('CSV', viewer.dialog))
    markdown.addEventListener('click', copyAs('Markdown', viewer.dialog))
    const { sizeFit } = fitWidth(fit, csv, frame, table, viewer.stage)
    close = viewer.close
  }

  expand.addEventListener('click', open)
  // First in the card, so Tab meets it where it is drawn: above the table.
  block.prepend(expand)
  return () => {
    close?.()
    expand.remove()
  }
}
