/**
 * The copy button every code block carries, on every surface: the reader, the
 * public site, presentation mode and the editor (ADR-041).
 *
 * One small icon button. It copies the whole block, or — when the reader has
 * selected text wholly inside the block — just that selection, and says which
 * ("Copy TypeScript code", "Copy selection"). It confirms with a check and
 * "Copied", announced through a polite live region, and goes back to offering
 * itself after a moment. A clipboard the browser refuses is not a dead end:
 * the text that would have been copied is selected instead, and the button
 * says which keys copy it.
 *
 * Framework-free and dependency-free, like the lightbox beside it: the editor
 * builds it into a ProseMirror node view, the signed-in reader and the public
 * site build it from `code-blocks.ts`. What it copies is the caller's to say
 * (`CopySource`), so line-number gutters and prompt glyphs, which are never
 * part of the code, are never part of what is copied.
 */

export type CopyMode = 'code' | 'selection'
export type CopyState = 'idle' | 'copied' | 'failed'

/** The part of `navigator.clipboard` the button uses. */
export interface ClipboardWriter {
  writeText(text: string): Promise<void>
}

/** What a button copies. */
export interface CopySource {
  /** The text to copy now, and whether it is the reader's selection or the whole block. */
  read(): { readonly text: string; readonly mode: CopyMode }
  /** Selects what `read` gives, so the reader can copy it with the keyboard. */
  select(): void
}

export interface CopyButtonOptions {
  readonly source: CopySource
  /** The language's name, for "Copy TypeScript code"; omitted, "Copy code". */
  readonly language?: string | undefined
  /** Defaults to the document's own `navigator.clipboard`, where there is one. */
  readonly clipboard?: ClipboardWriter | undefined
}

export interface CopyButton {
  readonly element: HTMLButtonElement
  /** Whether the button offers the selection or the whole block. */
  setMode(mode: CopyMode): void
  setLanguage(language: string | undefined): void
  /** Runs the copy, as a click does. */
  copy(): Promise<CopyState>
  dispose(): void
}

/** How long "Copied" stays before the button offers itself again. */
export const COPIED_MS = 1500
/** How long the keyboard hint stays after a refused copy: long enough to read and act on. */
export const FAILED_MS = 4000

const icon = (paths: string): string =>
  `<svg class="code-copy-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`

const ICONS: Readonly<Record<CopyMode | 'copied', string>> = {
  code: icon(
    '<rect x="5.75" y="5.75" width="7.5" height="7.5" rx="1.25"/><path d="M10.25 3.6A1.35 1.35 0 0 0 9 2.75H4A1.25 1.25 0 0 0 2.75 4v5c0 .58.37 1.08.85 1.25"/>',
  ),
  selection: icon(
    '<path d="M2.75 5.5V4A1.25 1.25 0 0 1 4 2.75h1.5M10.5 2.75H12A1.25 1.25 0 0 1 13.25 4v1.5M13.25 10.5V12A1.25 1.25 0 0 1 12 13.25h-1.5M5.5 13.25H4A1.25 1.25 0 0 1 2.75 12v-1.5"/><path d="M6 6.5h4M6 9.5h2.5"/>',
  ),
  copied: icon('<path d="M3.5 8.5l3 3 6-7"/>'),
}

/** The shortcut that copies on this platform, in the words its keyboard uses. */
export function copyShortcut(platform: string): string {
  return /mac|iphone|ipad|ipod/iu.test(platform) ? '⌘C' : 'Ctrl+C'
}

/** Writes text to the clipboard; false when there is none, or the browser refuses. */
export async function writeClipboard(
  text: string,
  clipboard: ClipboardWriter | undefined,
): Promise<boolean> {
  if (clipboard === undefined) return false
  try {
    await clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

const STATUS = 'code-copy-status'

/**
 * Says something through the page's one polite live region for copying,
 * made the first time it is needed, in `container` (the page, or an open
 * dialog). A button's own name changing is not
 * reliably announced; a status region is.
 */
export function announce(doc: Document, message: string, container: Element = doc.body): void {
  // Inside an open modal dialog the rest of the page is inert, and an inert
  // live region is never heard, so a caller in one passes the dialog.
  let region = container.querySelector<HTMLElement>(`:scope > .${STATUS}`)
  if (region === null) {
    region = doc.createElement('div')
    region.className = STATUS
    region.setAttribute('role', 'status')
    region.setAttribute('aria-live', 'polite')
    container.append(region)
  }
  // Emptied first, so the same words twice in a row are announced twice.
  region.textContent = ''
  const live = region
  const view = doc.defaultView
  if (view === null) {
    live.textContent = message
    return
  }
  view.requestAnimationFrame(() => {
    live.textContent = message
  })
}

function defaultClipboard(doc: Document): ClipboardWriter | undefined {
  return doc.defaultView?.navigator.clipboard ?? undefined
}

/** A press on the button must not take the reader's selection away before the click reads it. */
function keepSelection(event: MouseEvent): void {
  event.preventDefault()
}

/** A copy button for one block. Nothing happens until it is clicked. */
export function createCopyButton(doc: Document, options: CopyButtonOptions): CopyButton {
  const element = doc.createElement('button')
  element.type = 'button'
  element.className = 'code-copy'
  const glyph = doc.createElement('span')
  glyph.className = 'code-copy-glyph'
  const text = doc.createElement('span')
  text.className = 'code-copy-text'
  text.setAttribute('aria-hidden', 'true')
  element.append(glyph, text)

  let language = options.language
  let mode: CopyMode = 'code'
  let state: CopyState = 'idle'
  let timer: ReturnType<typeof setTimeout> | undefined
  const shortcut = copyShortcut(doc.defaultView?.navigator.platform ?? '')

  const offer = (): string =>
    mode === 'selection'
      ? 'Copy selection'
      : language === undefined
        ? 'Copy code'
        : `Copy ${language} code`

  const paint = (): void => {
    element.dataset['mode'] = mode
    element.dataset['state'] = state
    const words =
      state === 'copied' ? 'Copied' : state === 'failed' ? `Press ${shortcut} to copy` : offer()
    element.setAttribute('aria-label', words)
    element.title = words
    text.textContent = state === 'idle' && mode === 'code' ? 'Copy' : words
    glyph.innerHTML = state === 'copied' ? ICONS.copied : ICONS[mode]
  }

  const settle = (next: CopyState, after: number): void => {
    state = next
    paint()
    clearTimeout(timer)
    timer = setTimeout(() => {
      state = 'idle'
      paint()
    }, after)
  }

  const copy = async (): Promise<CopyState> => {
    const { text: value, mode: copied } = options.source.read()
    const done = await writeClipboard(value, options.clipboard ?? defaultClipboard(doc))
    if (done) {
      settle('copied', COPIED_MS)
      announce(doc, copied === 'selection' ? 'Selection copied' : 'Copied')
      return 'copied'
    }
    options.source.select()
    settle('failed', FAILED_MS)
    announce(
      doc,
      `Couldn’t copy. The ${copied === 'selection' ? 'selection' : 'code'} is selected: press ${shortcut} to copy it.`,
    )
    return 'failed'
  }

  const click = (): void => {
    void copy()
  }
  element.addEventListener('mousedown', keepSelection)
  element.addEventListener('click', click)
  paint()

  return {
    element,
    setMode(next) {
      if (next === mode) return
      mode = next
      paint()
    },
    setLanguage(next) {
      language = next
      paint()
    },
    copy,
    dispose() {
      clearTimeout(timer)
      element.removeEventListener('mousedown', keepSelection)
      element.removeEventListener('click', click)
      element.remove()
    },
  }
}

/**
 * The page's selection when it lies wholly inside an element and is more
 * than a caret; otherwise null. Cheap enough to ask on every
 * `selectionchange`: one range, one `contains`.
 */
export function selectionWithin(doc: Document, element: Node): Selection | null {
  const selection = doc.getSelection()
  if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return null
  return element.contains(selection.getRangeAt(0).commonAncestorContainer) ? selection : null
}

/** A block's code as a copy source: the selection inside it, else all of it. */
export function codeSource(code: () => Element): CopySource {
  return {
    read() {
      const block = code()
      const selection = selectionWithin(block.ownerDocument, block)
      return selection === null
        ? { text: block.textContent, mode: 'code' }
        : { text: selection.toString(), mode: 'selection' }
    },
    select() {
      const block = code()
      if (selectionWithin(block.ownerDocument, block) !== null) return
      block.ownerDocument.getSelection()?.selectAllChildren(block)
    },
  }
}
