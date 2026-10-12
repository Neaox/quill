import type { MermaidConfig } from 'mermaid'

import { BRAND } from '@quill/brand'

/**
 * Draws the Mermaid diagrams in a rendered document.
 *
 * The Markdown renderer cannot draw a diagram — Mermaid lays text out with a
 * browser's font metrics — so it emits a slot holding the diagram's source
 * (`<div class="diagram" data-diagram="mermaid"><pre><code>…`), and this
 * draws into it after the body is mounted. Mermaid is loaded only when a page
 * has a slot, as its own chunk, so no other page pays for it (quill-plan.md
 * section 31). The source stays in the slot under the drawing: it is what a
 * reader without JavaScript reads, what a failed diagram falls back to, and
 * what a redraw reads from.
 *
 * Two things are done to every drawing before it reaches the page:
 *
 * - **Its styles leave the markup.** Mermaid writes a `<style>` element and
 *   `style` attributes into its SVG, and the CSP (ADR-011) has no
 *   `'unsafe-inline'`, so a browser would refuse both. The stylesheet is
 *   adopted through the CSSOM instead and each `style` attribute is applied
 *   as `style.cssText`, which a style policy does not govern because nothing
 *   is parsed from markup.
 * - **It is coloured from the theme.** Mermaid needs literal colours to derive
 *   its shades, so the page's tokens are resolved to them when it is drawn,
 *   and it is drawn again when the theme changes.
 *
 * Mermaid runs with `securityLevel: 'strict'`: labels are sanitised, and click
 * handlers and links in a diagram are refused.
 */

/** The part of Mermaid this file calls. */
export interface MermaidApi {
  initialize(config: MermaidConfig): void
  render(id: string, text: string): Promise<{ readonly svg: string }>
}

/**
 * What drawing needs from the platform, injected so it can be tested without a
 * browser's layout engine (`docs/architecture/patterns.md`: ports and adapters).
 */
export interface DiagramEnvironment {
  /** Imports Mermaid; called at most once per drawing pass. */
  load(): Promise<MermaidApi>
  /** Mermaid theme variables, resolved from the page's tokens to literal colours. */
  palette(): Readonly<Record<string, string>>
  /** The family diagram text is measured and set in. */
  fontFamily(): string
  /** Applies a stylesheet to the document; returns what removes it again. */
  adoptStyles(css: string): () => void
  /** Calls back when light, dark, or the theme itself changes; returns the unsubscribe. */
  onThemeChange(listener: () => void): () => void
}

const SLOTS = '.diagram[data-diagram="mermaid"]'

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'

/** Marks an element whose `style` attribute was lifted, so it can be found after import. */
const LIFTED_STYLE = 'data-lifted-style'

/**
 * Refinements Mermaid's own theme cannot express. They are written against
 * tokens rather than resolved colours, so they follow the theme on their own.
 *
 * Thick edges are what a diagram sends, so they take the accent; every
 * arrowhead takes its own line's colour (`context-stroke`) rather than one
 * shared colour; group titles read as the small caps labels they are.
 */
const THEME_CSS = `
  .flowchart-link.edge-thickness-thick { stroke: var(--color-accent); stroke-width: 1.8px; }
  .marker, marker path { fill: context-stroke; stroke: context-stroke; }
  .node rect, .node polygon, .node path, .node circle { stroke-width: 1.2px; }
  .cluster rect { rx: 12px; ry: 12px; }
  .cluster-label text, .cluster-label span {
    font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase;
    fill: var(--color-muted);
  }
  .edgeLabel text, .edgeLabel span { font-size: 11px; font-weight: 500; }
  .messageText { font-size: 12px; }
  .noteText, .noteText tspan { font-size: 12px; }
`

let drawn = 0

/** A colour's relative lightness, enough to tell a light background from a dark one. */
function isDark(colour: string | undefined): boolean {
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})/i.exec(colour ?? '')
  if (match === null) return false
  const [red, green, blue] = match.slice(1).map((channel) => Number.parseInt(channel, 16))
  return 0.2126 * (red ?? 0) + 0.7152 * (green ?? 0) + 0.0722 * (blue ?? 0) < 128
}

function configFor(environment: DiagramEnvironment): MermaidConfig {
  const palette = environment.palette()
  const fontFamily = environment.fontFamily()
  return {
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    htmlLabels: false,
    suppressErrorRendering: true,
    fontFamily,
    themeVariables: { ...palette, darkMode: isDark(palette['background']), fontFamily },
    themeCSS: THEME_CSS,
    flowchart: { htmlLabels: false, padding: 14, nodeSpacing: 36, rankSpacing: 56 },
    sequence: { mirrorActors: false, messageMargin: 30, boxMargin: 8, noteMargin: 12 },
  }
}

interface Drawing {
  readonly svg: SVGSVGElement
  readonly css: string
}

/**
 * Parses Mermaid's SVG in an inert document and lifts its styles out of the
 * markup, so that nothing style-bearing is ever parsed in the live page.
 */
function liftStyles(markup: string, ownerDocument: Document): Drawing {
  const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml')
  const root = parsed.documentElement
  if (root.namespaceURI !== SVG_NAMESPACE || root.localName !== 'svg') {
    throw new Error('Mermaid did not return an SVG drawing.')
  }

  const css = [...root.querySelectorAll('style')]
    .map((element) => {
      element.remove()
      return element.textContent
    })
    .join('\n')
  const styled = [root, ...root.querySelectorAll('[style]')].filter((element) =>
    element.hasAttribute('style'),
  )
  for (const element of styled) {
    element.setAttribute(LIFTED_STYLE, element.getAttribute('style') ?? '')
    element.removeAttribute('style')
  }

  const svg = ownerDocument.importNode(root, true)
  if (!(svg instanceof SVGSVGElement)) throw new Error('Mermaid did not return an SVG drawing.')
  return { svg, css }
}

/** Applies lifted styles through the CSSOM, once the drawing is in the page. */
function restoreStyles(svg: SVGSVGElement): void {
  for (const element of [svg, ...svg.querySelectorAll(`[${LIFTED_STYLE}]`)]) {
    if (!(element instanceof SVGElement)) continue
    const lifted = element.getAttribute(LIFTED_STYLE)
    if (lifted === null) continue
    element.removeAttribute(LIFTED_STYLE)
    element.style.cssText = lifted
  }
}

/**
 * Mermaid sizes a drawing to shrink to its container without limit, which
 * turns a wide flowchart's text to specks. Its own width is handed to the
 * stylesheet instead (`--natural-width`), which lets it give way a little and
 * then scroll sideways in its slot, as a wide table does.
 */
function measure(svg: SVGSVGElement): void {
  const natural = Number.parseFloat(svg.style.maxWidth)
  svg.style.removeProperty('max-width')
  if (Number.isFinite(natural)) svg.style.setProperty('--natural-width', `${natural}px`)
}

/** The `title` a diagram's source gives itself in its front matter, if any. */
const FRONT_MATTER_TITLE = /^---\r?\n(?:.*\r?\n)*?title:[ \t]*(.+?)[ \t]*\r?\n(?:.*\r?\n)*?---/u

/** A slot's figure caption, on one line: the words an author wrote under the drawing. */
function captionOf(slot: HTMLElement): string | undefined {
  const words = slot.closest('figure')?.querySelector(':scope > figcaption')?.textContent
  const caption = words?.replace(/\s+/gu, ' ').trim()
  return caption === undefined || caption.length === 0 ? undefined : caption
}

/**
 * A drawing is an image to assistive technology (WCAG 1.1.1), named by
 * Mermaid's own title (`accTitle`, which it links itself), else by the
 * caption the author put under it, else by the title its source gives, and
 * only then plainly. Its source is its long description (`offerSource`).
 */
function label(svg: SVGSVGElement, slot: HTMLElement, source: string): void {
  svg.setAttribute('role', 'img')
  if (svg.hasAttribute('aria-labelledby') || svg.hasAttribute('aria-label')) return
  const titled = FRONT_MATTER_TITLE.exec(source)?.[1]
  svg.setAttribute('aria-label', captionOf(slot) ?? titled ?? 'Diagram')
}

/**
 * Keeps a drawn diagram's source in reach, as its long description: the
 * source is what Mermaid was written to be readable as, and says everything
 * the drawing does. It goes behind a closed "Diagram source" disclosure
 * rather than out of the page, so a sighted reader can open it too, and the
 * drawing points at it (`aria-details`). Returns what puts it back.
 */
function offerSource(slot: HTMLElement, svg: SVGSVGElement, id: string): () => void {
  const pre = slot.querySelector(':scope > pre')
  if (pre === null) return () => undefined
  const disclosure = slot.ownerDocument.createElement('details')
  disclosure.className = 'diagram-source'
  disclosure.id = `${id}-source`
  const summary = slot.ownerDocument.createElement('summary')
  summary.textContent = 'Diagram source'
  pre.before(disclosure)
  disclosure.append(summary, pre)
  svg.setAttribute('aria-details', disclosure.id)
  return () => {
    disclosure.replaceWith(pre)
  }
}

/**
 * Draws every diagram slot under `root`, and again whenever the theme changes.
 * Returns what stops it: pending drawings are abandoned and every adopted
 * stylesheet is removed.
 */
export function drawDiagrams(root: ParentNode, environment: DiagramEnvironment): () => void {
  const slots = [...root.querySelectorAll<HTMLElement>(SLOTS)]
  if (slots.length === 0) return () => undefined

  const removals = new Map<HTMLElement, () => void>()
  let pass = 0
  let disposed = false
  const stale = (current: number): boolean => disposed || current !== pass

  const place = (slot: HTMLElement, drawing: Drawing, id: string, source: string): void => {
    removals.get(slot)?.()
    const host = slot.ownerDocument.createElement('div')
    host.className = 'diagram-drawing'
    host.append(drawing.svg)
    slot.prepend(host)
    restoreStyles(drawing.svg)
    measure(drawing.svg)
    label(drawing.svg, slot, source)
    const restoreSource = offerSource(slot, drawing.svg, id)
    const removeStyles = environment.adoptStyles(drawing.css)
    removals.set(slot, () => {
      removeStyles()
      host.remove()
      restoreSource()
    })
    slot.setAttribute('data-state', 'drawn')
  }

  const drawAll = async (): Promise<void> => {
    pass += 1
    const current = pass
    for (const slot of slots) {
      if (!removals.has(slot)) slot.setAttribute('data-state', 'drawing')
    }
    const mermaid = await environment.load()
    if (stale(current)) return
    mermaid.initialize(configFor(environment))
    // One at a time: Mermaid keeps per-render state and does not promise that
    // two renders in flight leave each other alone.
    for (const slot of slots) {
      const source = slot.querySelector('code')?.textContent ?? ''
      try {
        drawn += 1
        const id = `${BRAND.slug}-diagram-${drawn}`
        const { svg } = await mermaid.render(id, source)
        if (stale(current)) return
        place(slot, liftStyles(svg, slot.ownerDocument), id, source)
      } catch {
        if (stale(current)) return
        removals.get(slot)?.()
        removals.delete(slot)
        slot.setAttribute('data-state', 'failed')
      }
    }
  }

  const failAll = (): void => {
    for (const slot of slots) {
      if (slot.getAttribute('data-state') === 'drawing') slot.setAttribute('data-state', 'failed')
    }
  }

  void drawAll().catch(failAll)
  const unsubscribe = environment.onThemeChange(() => {
    void drawAll().catch(failAll)
  })

  return () => {
    disposed = true
    unsubscribe()
    for (const remove of removals.values()) remove()
    removals.clear()
    for (const slot of slots) slot.removeAttribute('data-state')
  }
}
