/**
 * The diagram lightbox.
 *
 * A diagram is drawn for a wide canvas, and on a phone even a wide block
 * shrinks it until its labels are specks. So every diagram can be opened in
 * a modal that fills the screen: clicking the drawing opens it, and an
 * "Expand diagram" button does the same for a keyboard and a screen reader.
 * In the lightbox the drawing zooms and pans by pinch, wheel, drag, double
 * click and keyboard, and a phone turned on its side gives it the whole width.
 *
 * Enhancement only: without this script the diagram is exactly the figure it
 * was. The drawing itself is moved into the lightbox and back again rather
 * than copied, so its ids stay unique on the page, and it is wrapped in the
 * same `.prose .diagram` it came from, so the reading stylesheet colours it
 * there exactly as it does in the document. The native `<dialog>` provides the
 * focus trap, Escape and the top layer; focus returns to the button. Opening
 * and closing are animated in CSS (`prose.css`, "Lightbox"), which honours a
 * reader's reduced-motion setting.
 *
 * Framework-free and dependency-free on purpose: the signed-in application
 * imports it, and the public site, which has no bundler, is served it as part
 * of the reader script bundled from this package (`../reader/reader.ts`).
 */

import type { GestureHint } from '../viewer/viewer.ts'
import { hintFor, iconButton, openViewer, VIEWER_ICONS, viewerControl } from '../viewer/viewer.ts'

/* --- The arithmetic ------------------------------------------------------ */

/*
 * A scale and an offset, in the stage's own pixels with the drawing fitted to
 * it at scale 1, which is why 1 is the floor: smaller than fitting the stage
 * shows nothing more.
 */

export interface View {
  readonly scale: number
  readonly x: number
  readonly y: number
}

export interface Point {
  readonly x: number
  readonly y: number
}

export const MIN_SCALE = 1
export const MAX_SCALE = 8

/** The drawing fitted to the stage. */
export const FIT: View = { scale: 1, x: 0, y: 0 }

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}

/**
 * Zooms to `scale` about `origin`, keeping the point of the drawing under the
 * origin where it was on screen, as a pinch or a wheel under the pointer does.
 * Back at scale 1 the drawing is fitted again, whatever the panning was.
 */
export function zoomAt(view: View, scale: number, origin: Point): View {
  const next = clampScale(scale)
  if (next === view.scale) return view
  if (next === MIN_SCALE) return FIT
  const ratio = next / view.scale
  return {
    scale: next,
    x: origin.x - (origin.x - view.x) * ratio,
    y: origin.y - (origin.y - view.y) * ratio,
  }
}

/** Moves the view by what was dragged; a fitted drawing has nowhere to go. */
export function pan(view: View, by: Point): View {
  if (view.scale === MIN_SCALE) return view
  return { scale: view.scale, x: view.x + by.x, y: view.y + by.y }
}

/**
 * How much wider than tall a drawing must be before turning a phone helps. A
 * near-square drawing gains little from it.
 */
const WIDE_RATIO = 1.25

/**
 * Whether a drawing is clearly landscape, by its view box or, without one, its
 * width and height. A drawing that says neither is not called wide.
 */
export function isWide(svg: SVGSVGElement): boolean {
  const box = (svg.getAttribute('viewBox') ?? '')
    .trim()
    .split(/[\s,]+/u)
    .map(Number)
  const [width, height] =
    box.length === 4
      ? box.slice(2)
      : [Number(svg.getAttribute('width')), Number(svg.getAttribute('height'))]
  return width !== undefined && height !== undefined && height > 0 && width / height >= WIDE_RATIO
}

export type { GestureHint } from '../viewer/viewer.ts'

/**
 * The line under the drawing, in the gestures the reader actually has: the
 * viewer's hint (`hintFor`), in the words of zooming and panning.
 */
export function gestureHint(device: {
  readonly touch: boolean
  readonly portrait: boolean
  readonly wide: boolean
}): GestureHint {
  return hintFor(device, {
    pointer: 'Scroll to zoom · drag to pan',
    touch: 'Pinch to zoom · drag to pan',
  })
}

/* --- The dialog ---------------------------------------------------------- */

const STEP = 1.5
/** How far one press of an arrow key pans a zoomed drawing, in pixels. */
export const PAN_STEP = 48

/** The readout's name: what it shows, then what pressing it does. */
const READOUT = (percent: string): string => `${percent}, fit or twice the size`
const DOUBLE = 2
const WHEEL_SENSITIVITY = 0.002

const icon = (path: string): string =>
  `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><path d="${path}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`

const ICONS = {
  expand: VIEWER_ICONS.expand,
  out: icon('M3.5 8h9'),
  in: icon('M3.5 8h9M8 3.5v9'),
} as const

export interface Opened {
  readonly dialog: HTMLDialogElement
  readonly close: () => void
}

/**
 * The drawing in a diagram slot: an SVG drawn inline sits directly in it, a
 * Mermaid drawing in its `.diagram-drawing` host. Never any other SVG it
 * holds, such as the expand button's own icon.
 */
function drawingOf(diagram: Element): SVGSVGElement | null {
  return diagram.querySelector(':scope > svg, :scope > .diagram-drawing > svg')
}

function labelOf(diagram: Element): string | null {
  return drawingOf(diagram)?.getAttribute('aria-label') ?? null
}

/**
 * A short name for a drawing: its first sentence. Alternative text is often
 * a paragraph, which is a description, not a name (WCAG 2.4.6).
 */
export function shortName(text: string): string {
  const [first = text] = text.split(/(?<=[.!?])\s/u)
  return first.trim()
}

export function captionOf(container: Element): string | null {
  return container.querySelector(':scope > figcaption')?.textContent?.trim() ?? null
}

function distance([first, second]: readonly [Point, Point]): number {
  return Math.hypot(second.x - first.x, second.y - first.y)
}

function midpoint([first, second]: readonly [Point, Point]): Point {
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }
}

/** The lightbox's own controls, in the order they sit; the viewer adds Close. */
const CONTROL_ORDER = ['out', 'zoom', 'in'] as const
type ControlAction = (typeof CONTROL_ORDER)[number]

/** What the lightbox shows, zoomed and panned: a drawing, a picture. */
export interface Zoomable {
  /** The dialog's accessible name. */
  readonly label: string
  /** The caption at the foot, or null for none. */
  readonly caption: string | null
  /** What is zoomed and panned, drawn on the canvas. */
  readonly frame: HTMLElement
  /** Clearly landscape, so a phone is told to turn. */
  readonly wide: boolean
  /** Where focus returns. */
  readonly trigger: HTMLElement
  /** Runs as the lightbox closes, before focus returns. */
  readonly onClose?: (() => void) | undefined
}

/*
 * Zooming in and out are used all the time, so at a limit they stay where
 * they are, disabled with the reason (`docs/design/feedback.md`, "Disable
 * or hide"): `aria-disabled`, not `disabled`, so they stay focusable and
 * the reason can be read.
 */
function limit(button: HTMLButtonElement, reached: boolean, reason: string): void {
  if (reached) {
    button.setAttribute('aria-disabled', 'true')
    button.title = reason
  } else {
    button.removeAttribute('aria-disabled')
    button.removeAttribute('title')
  }
}

/**
 * Opens `subject` in the lightbox, with its zoom and pan controls. The one lightbox a diagram and
 * a picture share, so both zoom, pan and close the same way.
 */
export function openZoomable(
  doc: Document,
  { label, caption, frame, wide, trigger, onClose }: Zoomable,
): Opened {
  const buttons: Readonly<Record<ControlAction, HTMLButtonElement>> = {
    out: viewerControl(doc, 'out', 'Zoom out', ICONS.out),
    zoom: viewerControl(doc, 'zoom', READOUT('100%'), '100%'),
    in: viewerControl(doc, 'in', 'Zoom in', ICONS.in),
  }
  const readout = buttons.zoom
  readout.classList.add('lightbox-readout')
  buttons.out.setAttribute('aria-keyshortcuts', '-')
  buttons.in.setAttribute('aria-keyshortcuts', '+')
  readout.setAttribute('aria-keyshortcuts', '0')

  const canvas = doc.createElement('div')
  canvas.className = 'lightbox-canvas'
  canvas.append(frame)

  const { dialog, stage } = openViewer(doc, {
    label,
    caption,
    controls: CONTROL_ORDER.map((action) => buttons[action]),
    content: [canvas],
    hint: (device) => gestureHint({ ...device, wide }),
    trigger,
    onClose: () => {
      onClose?.()
      // Closed mid-drag (Escape), the drag is over too.
      delete doc.documentElement.dataset['dragging']
    },
  })

  let view: View = FIT
  const limits = (): void => {
    limit(buttons.out, view.scale <= MIN_SCALE, 'Already fitted to the screen')
    limit(buttons.in, view.scale >= MAX_SCALE, 'Already at the largest size')
  }
  const show = (next: View): void => {
    view = next
    canvas.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`
    const percent = `${Math.round(view.scale * 100)}%`
    readout.textContent = percent
    // Named by what it shows, then what it does (WCAG 2.5.3).
    readout.setAttribute('aria-label', READOUT(percent))
    stage.dataset['zoomed'] = String(view.scale > MIN_SCALE)
    dialog.dataset['used'] = 'true'
    limits()
  }
  limits()
  const local = (clientX: number, clientY: number): Point => {
    const box = stage.getBoundingClientRect()
    return { x: clientX - box.left, y: clientY - box.top }
  }
  const centre = (): Point => {
    const box = stage.getBoundingClientRect()
    return { x: box.width / 2, y: box.height / 2 }
  }
  const zoomBy = (factor: number, origin: Point = centre()): void => {
    show(zoomAt(view, view.scale * factor, origin))
  }
  const toggle = (origin: Point = centre()): void => {
    show(view.scale === MIN_SCALE ? zoomAt(view, DOUBLE, origin) : FIT)
  }
  const zoomIn = (): void => {
    zoomBy(STEP)
  }
  const zoomOut = (): void => {
    zoomBy(1 / STEP)
  }

  const actions: Readonly<Record<ControlAction, () => void>> = {
    in: zoomIn,
    out: zoomOut,
    zoom: () => {
      toggle()
    },
  }
  // The arrow keys pan a zoomed drawing, as dragging does (WCAG 2.1.1);
  // Home fits it again.
  const panBy = (x: number, y: number) => (): void => {
    show(pan(view, { x, y }))
  }
  const fit = (): void => {
    show(FIT)
  }
  const keys: Readonly<Record<string, () => void>> = {
    '+': zoomIn,
    '=': zoomIn,
    '-': zoomOut,
    '0': fit,
    Home: fit,
    ArrowLeft: panBy(PAN_STEP, 0),
    ArrowRight: panBy(-PAN_STEP, 0),
    ArrowUp: panBy(0, PAN_STEP),
    ArrowDown: panBy(0, -PAN_STEP),
  }

  for (const action of CONTROL_ORDER) buttons[action].addEventListener('click', actions[action])
  dialog.addEventListener('keydown', (event) => {
    const key = keys[event.key]
    if (key === undefined) return
    // A control keeps its own keys: Enter and Space press it, Tab leaves it.
    if (event.key.startsWith('Arrow') || event.key === 'Home') event.preventDefault()
    key()
  })
  // The backdrop is the dialog itself: a click that lands on it, and not on
  // anything inside, is a click outside the lightbox.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close()
  })
  stage.addEventListener('dblclick', (event) => {
    toggle(local(event.clientX, event.clientY))
  })
  stage.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault()
      zoomBy(Math.exp(-event.deltaY * WHEEL_SENSITIVITY), local(event.clientX, event.clientY))
    },
    { passive: false },
  )

  // Pointers down on the stage, by id: one drags, two pinch. While one is down
  // the stage says so, and the stylesheet drops the easing, so the drawing
  // stays under the finger instead of trailing it.
  const pointers = new Map<number, Point>()
  const pinch = (): readonly [Point, Point] | null => {
    const [first, second] = [...pointers.values()]
    return first === undefined || second === undefined ? null : [first, second]
  }
  stage.addEventListener('pointerdown', (event) => {
    stage.setPointerCapture(event.pointerId)
    pointers.set(event.pointerId, local(event.clientX, event.clientY))
    stage.dataset['dragging'] = 'true'
    // No text selection while a drag lasts, and only while it lasts.
    doc.documentElement.dataset['dragging'] = 'true'
  })
  stage.addEventListener('pointermove', (event) => {
    const before = pointers.get(event.pointerId)
    if (before === undefined) return
    const now = local(event.clientX, event.clientY)
    const was = pinch()
    pointers.set(event.pointerId, now)
    const after = pinch()
    if (was === null || after === null) {
      show(pan(view, { x: now.x - before.x, y: now.y - before.y }))
      return
    }
    const span = distance(was)
    if (span > 0) zoomBy(distance(after) / span, midpoint(after))
  })
  const release = (event: PointerEvent): void => {
    pointers.delete(event.pointerId)
    if (pointers.size === 0) {
      delete stage.dataset['dragging']
      delete doc.documentElement.dataset['dragging']
    }
  }
  stage.addEventListener('pointerup', release)
  stage.addEventListener('pointercancel', release)

  return { dialog, close: () => dialog.close() }
}

function open(
  diagram: HTMLElement,
  container: HTMLElement,
  trigger: HTMLButtonElement,
): Opened | null {
  const svg = drawingOf(diagram)
  if (svg === null) return null
  const doc = diagram.ownerDocument
  const caption = captionOf(container)
  // Named by the caption when there is one, else the alternative text's first sentence; the
  // caption describes it in full (`aria-describedby`). Read before the drawing is moved.
  const label = caption ?? shortName(labelOf(diagram) ?? 'Diagram')
  const frame = doc.createElement('div')
  frame.className = 'diagram'
  frame.dataset['diagram'] = diagram.dataset['diagram'] ?? 'svg'
  frame.dataset['state'] = 'drawn'
  const placeholder = doc.createComment('diagram in the lightbox')
  svg.replaceWith(placeholder)
  frame.append(svg)
  return openZoomable(doc, {
    label,
    caption,
    frame,
    wide: isWide(svg),
    trigger,
    onClose: () => {
      placeholder.replaceWith(svg)
    },
  })
}

/**
 * Gives every diagram under `root` its expand button, and makes the drawing
 * itself open the lightbox. Returns what takes it all away again, closing an
 * open lightbox first so the drawing is back where it belongs.
 */
export function enhanceDiagrams(root: ParentNode): () => void {
  const undo: (() => void)[] = []
  const diagrams: HTMLElement[] = []
  let opened: Opened | null = null

  for (const diagram of root.querySelectorAll<HTMLElement>('.diagram')) {
    const parent = diagram.parentElement
    const container = parent?.tagName === 'FIGURE' ? parent : diagram
    if (container.querySelector(':scope > .diagram-expand') !== null) continue

    const expand = iconButton(diagram.ownerDocument, 'diagram-expand', '', ICONS.expand)
    // A Mermaid drawing has no name until it is drawn, so the button's name is
    // read again whenever it is reached.
    const name = (): void => {
      const label = labelOf(diagram)
      expand.setAttribute(
        'aria-label',
        label === null ? 'Expand diagram' : `Expand diagram: ${shortName(label)}`,
      )
    }
    name()
    expand.addEventListener('focus', name)
    const show = (): void => {
      opened = open(diagram, container, expand)
    }
    // The drawing opens too, for a pointer; the button is the way in for a
    // keyboard and a screen reader, so the drawing itself stays out of the
    // tab order. A diagram outside a figure holds its own button, so a click
    // on the button is left to the button rather than opening twice.
    const showFromDrawing = (event: Event): void => {
      if (event.target instanceof Element && event.target.closest('.diagram-expand') !== null)
        return
      show()
    }
    expand.addEventListener('click', show)
    diagram.addEventListener('click', showFromDrawing)
    diagram.dataset['expandable'] = 'true'
    container.prepend(expand)
    undo.push(() => {
      expand.remove()
      diagram.removeEventListener('click', showFromDrawing)
      delete diagram.dataset['expandable']
    })
    diagrams.push(diagram)
  }

  // A drawing wider than its column scrolls sideways in place, so while it
  // does it is a named, focusable group a keyboard can scroll (WCAG 2.1.1).
  const Observer = root.ownerDocument?.defaultView?.ResizeObserver
  const scrollable = (): void => {
    for (const diagram of diagrams) {
      const scrolls = diagram.scrollWidth > diagram.clientWidth + 1
      if (scrolls) {
        diagram.tabIndex = 0
        diagram.setAttribute('role', 'group')
        diagram.setAttribute('aria-label', shortName(labelOf(diagram) ?? 'Diagram'))
      } else if (diagram.hasAttribute('tabindex')) {
        diagram.removeAttribute('tabindex')
        diagram.removeAttribute('role')
        diagram.removeAttribute('aria-label')
      }
    }
  }
  const watcher = Observer === undefined ? undefined : new Observer(scrollable)
  for (const diagram of diagrams) watcher?.observe(diagram)
  undo.push(() => {
    watcher?.disconnect()
    for (const diagram of diagrams) {
      for (const name of ['tabindex', 'role', 'aria-label']) diagram.removeAttribute(name)
    }
  })

  return () => {
    if (opened?.dialog.isConnected === true) opened.close()
    for (const step of undo) step()
  }
}
