/**
 * The full-screen viewer: the one dialog a diagram and a table open in.
 *
 * A native `<dialog class="lightbox">` with the caller's controls floating
 * at its top right and Close last; a stage that holds what is shown; a line
 * of gesture hints under it; and the caption at its foot, as a figure's sits.
 * The native dialog provides the focus trap, Escape and the top layer. Focus
 * starts on the dialog itself, not on its first control, because the reader
 * came to look; it returns to the button that opened it. A click on the
 * backdrop, which is the dialog itself, closes it. While one is open the page
 * says so (`html.lightbox-open`), so the stylesheet can stop it scrolling.
 *
 * Framework-free and dependency-free, like everything in this package that
 * runs in a browser: the signed-in application imports it, and the public
 * site is served it in the bundled reader script (`../reader/reader.ts`).
 * The diagram lightbox (`../lightbox/lightbox.ts`) and the table viewer
 * (`../tables/table-viewer.ts`) are its two callers.
 */

/** What a reader can do on this device, which decides what the hint says. */
export interface Device {
  readonly touch: boolean
  readonly portrait: boolean
}

export interface GestureHint {
  readonly text: string
  /** Whether the hint suggests turning the device, which draws it with the turning phone. */
  readonly turn: boolean
}

/** What a hint says on each kind of device. */
export interface HintWords {
  /** With a mouse or trackpad; empty says nothing. */
  readonly pointer: string
  /** On a touch screen. */
  readonly touch: string
}

const TURN = 'Turn your phone for a larger view'

/**
 * The line under what is shown, in the gestures the reader actually has. A
 * touch screen held upright shows something wide at its smallest, so there,
 * and only for something wide, the hint suggests turning it. A device that
 * cannot turn is told nothing untrue: it is a suggestion. Empty text says
 * nothing, and the viewer hides the line.
 */
export function hintFor(
  device: Device & { readonly wide: boolean },
  words: HintWords,
): GestureHint {
  if (!device.touch) return { text: words.pointer, turn: false }
  return device.portrait && device.wide
    ? { text: TURN, turn: true }
    : { text: words.touch, turn: false }
}

const icon = (path: string): string =>
  `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><path d="${path}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`

/** The icons the viewer's callers share. */
export const VIEWER_ICONS = {
  expand: icon('M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5 9 7M2.5 13.5 7 9'),
  close: icon('M4 4l8 8M12 4l-8 8'),
} as const

/**
 * A phone turning from upright to its side, the gesture the hint asks for:
 * the phone is drawn upright and the stylesheet turns it, with a curved arrow
 * showing which way (`.lightbox-turn` in `prose.css`).
 */
const TURN_ICON = [
  '<svg class="lightbox-turn" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">',
  '<path class="lightbox-turn-arrow" d="M4.5 9.5a8 8 0 0 1 6-6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  '<path class="lightbox-turn-arrow" d="M8.5 3.2l2 .3-.6 2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
  '<g class="lightbox-turn-phone"><rect x="8.5" y="7" width="7" height="12" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/>',
  '<path d="M11 16.5h2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></g>',
  '</svg>',
].join('')

/** An icon button named for what it does. */
export function iconButton(
  doc: Document,
  className: string,
  label: string,
  html: string,
): HTMLButtonElement {
  const element = doc.createElement('button')
  element.type = 'button'
  element.className = className
  element.setAttribute('aria-label', label)
  element.innerHTML = html
  return element
}

/** One of the viewer's floating controls. */
export function viewerControl(
  doc: Document,
  action: string,
  label: string,
  html: string,
): HTMLButtonElement {
  const element = iconButton(doc, 'lightbox-control', label, html)
  element.dataset['action'] = action
  return element
}

export interface ViewerOptions {
  /** The dialog's accessible name. */
  readonly label: string
  /** The caption at the foot, or null for none. */
  readonly caption: string | null
  /** The caller's controls, which sit before Close. */
  readonly controls: readonly HTMLButtonElement[]
  /** What the stage shows. */
  readonly content: readonly Node[]
  /** The stage's own class, beside `lightbox-stage prose`. */
  readonly stageClass?: string | undefined
  /** The hint on this device, asked again when the device turns. */
  readonly hint: (device: Device) => GestureHint
  /** Where focus returns. */
  readonly trigger: HTMLElement
  /** Runs as the viewer closes, before focus returns. */
  readonly onClose?: (() => void) | undefined
  /**
   * Runs when the stage changes size: a resize, a turn, a change of text
   * size. A control that can only act at some sizes is shown or hidden here
   * (`docs/design/feedback.md`, "Disable or hide").
   */
  readonly onResize?: (() => void) | undefined
  /** The ResizeObserver to watch the stage with; the window's own by default. */
  readonly ResizeObserver?: ResizeObserverClass | undefined
}

/** A ResizeObserver, as the viewer uses one. */
export type ResizeObserverClass = new (callback: () => void) => {
  observe(target: Element): void
  disconnect(): void
}

export interface Viewer {
  readonly dialog: HTMLDialogElement
  readonly stage: HTMLElement
  readonly close: () => void
}

/** Numbers the viewers' caption ids, which a page never has two of at once. */
let captions = 0

/** Opens the viewer over the page. */
export function openViewer(doc: Document, options: ViewerOptions): Viewer {
  const dialog = doc.createElement('dialog')
  dialog.className = 'lightbox'
  dialog.setAttribute('aria-label', options.label)
  dialog.tabIndex = -1

  const controls = doc.createElement('div')
  controls.className = 'lightbox-controls'
  const close = viewerControl(doc, 'close', 'Close', VIEWER_ICONS.close)
  close.addEventListener('click', () => {
    dialog.close()
  })
  controls.append(...options.controls, close)

  const stage = doc.createElement('div')
  stage.className = ['lightbox-stage', 'prose', options.stageClass ?? ''].join(' ').trim()
  const hint = doc.createElement('p')
  hint.className = 'lightbox-hint'
  hint.setAttribute('aria-hidden', 'true')
  const media = (query: string): MediaQueryList | undefined => doc.defaultView?.matchMedia?.(query)
  const portrait = media('(orientation: portrait)')
  const writeHint = (): void => {
    const said = options.hint({
      touch: media('(pointer: coarse)')?.matches ?? false,
      portrait: portrait?.matches ?? false,
    })
    hint.hidden = said.text === ''
    hint.innerHTML = said.turn ? TURN_ICON : ''
    hint.append(said.text)
    hint.dataset['turn'] = String(said.turn)
  }
  writeHint()
  // Turned while open, the hint follows: no "turn your phone" once it is turned.
  portrait?.addEventListener('change', writeHint)
  stage.append(...options.content, hint)
  dialog.append(controls, stage)
  // The caption sits under what is shown, as a figure's does, and leaves the
  // top to the controls. Without one, the dialog's name says what it is.
  if (options.caption !== null) {
    const footer = doc.createElement('p')
    footer.className = 'lightbox-caption'
    footer.id = `lightbox-caption-${(captions += 1)}`
    footer.textContent = options.caption
    dialog.append(footer)
    // The caption describes what the dialog shows; its name stays short.
    dialog.setAttribute('aria-describedby', footer.id)
  }

  // The backdrop is the dialog itself: a click that lands on it, and not on
  // anything inside, is a click outside the viewer.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close()
  })

  const Observer = options.ResizeObserver ?? doc.defaultView?.ResizeObserver
  const { onResize } = options
  const resizes =
    onResize === undefined || Observer === undefined ? undefined : new Observer(onResize)
  resizes?.observe(stage)

  const root = doc.documentElement
  dialog.addEventListener('close', () => {
    resizes?.disconnect()
    portrait?.removeEventListener('change', writeHint)
    options.onClose?.()
    dialog.remove()
    root.classList.remove('lightbox-open')
    options.trigger.focus()
  })

  doc.body.append(dialog)
  root.classList.add('lightbox-open')
  dialog.showModal()
  dialog.focus()
  return { dialog, stage, close: () => dialog.close() }
}
