import type { DrawingRendering, DrawingSource } from '../contract.ts'

/**
 * How a `.drawio.svg` is drawn in a document (ADR-043, "Reading").
 *
 * A `.drawio.svg` is an ordinary SVG that also carries its diagram source,
 * so it takes ADR-036's drawing pipeline, with three differences:
 *
 * - **The source is removed first.** draw.io's `content` attribute is the
 *   whole editable diagram, often larger than the picture. It is not part of
 *   what a reader sees, so it never reaches the page, and removing it before
 *   the drawing is parsed spares the allowlist from parsing it at all.
 * - **Its colours follow light and dark.** draw.io writes a diagram's
 *   adaptive colours (`light-dark(…)`) into `style` attributes, which a page
 *   under Quill's CSP cannot carry; the allowlist reads them as presentation
 *   attributes instead (`render/drawing.ts`). The one value draw.io leaves to
 *   its own stylesheet, the adaptive shape background, is spelled out here.
 *   A diagram drawn without adaptive colours keeps its fixed ones and is
 *   marked `fixed`, so the reading stylesheet sets it on paper in the dark.
 * - **It is drawn at its own size**, as a figure, because draw.io diagrams
 *   are laid out at a size rather than for the measure.
 *
 * A diagram whose labels are HTML (`foreignObject`, draw.io's default before
 * Quill asks for SVG text) or which holds embedded pictures (`image`) would
 * lose its words or pictures inline, so it is shown as an `<img>` of the
 * stored file instead — the browser's own sandbox for an SVG — and marked
 * `data-drawio-legacy`, which is where the editor offers to re-save it.
 */

/**
 * draw.io's root carries its source as `content="&lt;mxfile…"`, or a bare model.
 *
 * A start tag's attributes are read up to the next `<`, which XML never
 * allows inside a tag or an attribute value, so each `<svg` in a hostile
 * file is scanned only as far as the next tag, never to the end of the file.
 */
const DRAWIO_ROOT =
  /<svg\b(?:[^<>"']|"[^<"]*"|'[^<']*')*\scontent\s*=\s*"(?:&lt;|<)(?:mxfile|mxGraphModel)\b/i

const CONTENT_ATTRIBUTE = /(<svg\b(?:[^<>"']|"[^<"]*"|'[^<']*')*?)\scontent\s*=\s*"[^"]*"/i

/** What an inline drawing cannot show without losing it. */
const NOT_INLINE = /<(?:foreignObject|image)\b/i

/**
 * draw.io's adaptive shape fill, `var(--ge-adaptive-bg, <light>)`, defined in
 * the drawing's own stylesheet as `light-dark(<light>, #121212)` —
 * `#121212` being `--ge-dark-color`'s default, the canvas of draw.io's own
 * dark mode. The stylesheet is never applied, so the value is written out.
 * The value is read as one bounded run and trimmed afterwards: whitespace
 * matched on both sides of an open-ended run is a cubic search when the
 * value never closes.
 */
const ADAPTIVE_BACKGROUND = /var\(--ge-adaptive-bg,([^)]{0,256})\)/g
const DARK_CANVAS = '#121212'

const ADAPTIVE_COLOURS = /light-dark\(/

export function isDrawioDrawing(drawing: DrawingSource): boolean {
  return DRAWIO_ROOT.test(drawing.markup)
}

/** The drawing without its diagram source: what the page is allowed to see of it. */
export function withoutDrawioSource(markup: string): string {
  return markup.replace(CONTENT_ATTRIBUTE, '$1')
}

export function renderDrawioDrawing(drawing: DrawingSource): DrawingRendering {
  const picture = withoutDrawioSource(drawing.markup)
  if (NOT_INLINE.test(picture)) return { kind: 'image', data: { 'data-drawio-legacy': '' } }
  return {
    kind: 'inline',
    markup: picture.replaceAll(ADAPTIVE_BACKGROUND, (whole, light: string) =>
      light.trim() === '' ? whole : `light-dark(${light.trim()}, ${DARK_CANVAS})`,
    ),
    naturalSize: true,
    data: { 'data-drawio': ADAPTIVE_COLOURS.test(picture) ? 'adaptive' : 'fixed' },
  }
}
