import { fromHtml } from 'hast-util-from-html'
import type { Element, ElementContent, Properties, RootContent } from 'hast'
import { find, svg } from 'property-information'

/**
 * A hand-drawn SVG diagram, made safe to draw inline in a document.
 *
 * Drawn inline rather than shown as an `<img>` because a diagram has to take
 * the page's colours, in light and dark, and an image cannot: an `<img>` is
 * its own document, styled only by itself. Inline, it is styled by the
 * reading stylesheet through a small class vocabulary (`box`, `send`,
 * `label`, … in `packages/design-css/src/prose.css`), which is also why the
 * drawing's own `<style>` is removed: it exists so the file reads on its own,
 * on GitHub or in a viewer, and it is not ours to apply.
 *
 * Inline is also why this is an allowlist and not a filter (ADR-011). An SVG
 * is a document: it can carry script, event handlers, links, animations that
 * rewrite links, foreign HTML, external images and stylesheets, and paint
 * servers in other files. Only the elements and attributes a static diagram
 * needs survive — shapes, text, markers, gradients — and only with values of
 * the shape that attribute takes, so nothing that runs, fetches, or navigates
 * can be expressed in what is left.
 *
 * Every id is prefixed, and every reference to one rewritten to match, so two
 * drawings on one page cannot capture each other's markers and no drawing can
 * mint an id the application relies on (the same clobbering concern as the
 * heading ids in `sanitize-schema.ts`).
 */

export interface DrawingOptions {
  /** Prepended to every id in the drawing; unique per drawing on a page. */
  readonly idPrefix: string
  /** What the drawing shows, for assistive technology: the image's alternative text. */
  readonly label: string
}

/** More elements than any diagram a person draws; past it, the file is not a diagram. */
const MAX_ELEMENTS = 20_000

const ELEMENTS = new Set([
  'svg',
  'g',
  'defs',
  'marker',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'title',
  'desc',
  'linearGradient',
  'radialGradient',
  'stop',
  'clipPath',
])

/** Attributes whose value is a number, a list of numbers, or a keyword. */
const PLAIN = new Set([
  'viewBox',
  'preserveAspectRatio',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'fx',
  'fy',
  'dx',
  'dy',
  'width',
  'height',
  'points',
  'd',
  'pathLength',
  'refX',
  'refY',
  'markerWidth',
  'markerHeight',
  'markerUnits',
  'orient',
  'gradientUnits',
  'gradientTransform',
  'spreadMethod',
  'offset',
  'clipPathUnits',
  'text-anchor',
  'dominant-baseline',
  'alignment-baseline',
  'font-size',
  'font-weight',
  'font-style',
  'letter-spacing',
  'stroke-width',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'paint-order',
  'opacity',
  'fill-opacity',
  'stroke-opacity',
  'stop-opacity',
  'fill-rule',
  'clip-rule',
  'vector-effect',
  'visibility',
])

/** Attributes that take a colour, or a reference to a paint server in the same drawing. */
const PAINT = new Set(['fill', 'stroke', 'stop-color'])

/** Attributes that take only a reference to an element in the same drawing. */
const REFERENCE = new Set(['marker-start', 'marker-mid', 'marker-end', 'clip-path'])

/** Numbers, lists of numbers, units and keywords: nothing with a parenthesis, colon or quote. */
const PLAIN_VALUE = /^[\w\s.,%#+-]*$/

/** `matrix(…)`, `translate(…)` and their kind, and nothing else. */
const TRANSFORM_VALUE =
  /^(?:\s*(?:matrix|translate|scale|rotate|skewX|skewY)\([\d\s.,eE+-]*\)\s*,?)*\s*$/

const REFERENCE_VALUE = /^url\(#([A-Za-z][\w.-]*)\)$/

/** A colour as CSS writes one, without `url(` and without anything that could become one. */
const COLOUR_VALUE =
  /^(?:none|currentColor|transparent|context-fill|context-stroke|[a-z]+|#[\da-f]{3,8}|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\([\d\s.,%/+-]*(?:deg|turn|rad)?[\d\s.,%/+-]*\))$/i

/**
 * `light-dark(<colour>, <colour>)`: a colour for each scheme, picked by the
 * page's `color-scheme`, which is how a drawing made with adaptive colours
 * (draw.io's, ADR-043) follows light and dark. Each half is checked as a
 * colour on its own, so nothing is admitted inside one that is not admitted
 * outside it.
 */
function isLightDark(value: string): boolean {
  const inner = /^light-dark\((.*)\)$/i.exec(value)?.[1]
  if (inner === undefined) return false
  let depth = 0
  const split = [...inner].findIndex((character) => {
    if (character === '(') depth += 1
    if (character === ')') depth -= 1
    return character === ',' && depth === 0
  })
  if (split < 0) return false
  return [inner.slice(0, split), inner.slice(split + 1)].every((half) =>
    COLOUR_VALUE.test(half.trim()),
  )
}

function isColour(value: string): boolean {
  return COLOUR_VALUE.test(value) || isLightDark(value)
}

const FONT_FAMILY_VALUE = /^[\w\s,'"-]*$/

const ID_VALUE = /^[A-Za-z][\w.-]*$/

const CLASS_TOKEN = /^[A-Za-z][\w-]*$/

/** The attribute a hast property was parsed from, in the SVG space. */
function attributeOf(property: string): string {
  return find(svg, property).attribute
}

/**
 * A property's value as the attribute text it was parsed from: a list (a
 * class, a dash array) joined by spaces, anything else as written. A boolean
 * becomes `true` or `false`, which no kept attribute accepts, so it is dropped
 * by the same checks as any other value.
 */
function text(value: unknown): string {
  return Array.isArray(value) ? value.map(String).join(' ') : String(value)
}

/**
 * One attribute's value as it may be kept, or undefined to drop it. References
 * are rewritten to the prefixed ids here.
 */
function keep(attribute: string, value: string, prefix: string): string | undefined {
  const reference = (id: string): string => `url(#${prefix}${id})`
  if (attribute === 'id') return ID_VALUE.test(value) ? `${prefix}${value}` : undefined
  if (attribute === 'class') {
    const tokens = value.split(/\s+/).filter((token) => CLASS_TOKEN.test(token))
    return tokens.length === 0 ? undefined : tokens.join(' ')
  }
  if (PAINT.has(attribute)) {
    const match = REFERENCE_VALUE.exec(value.trim())
    if (match?.[1] !== undefined) return reference(match[1])
    return isColour(value.trim()) ? value.trim() : undefined
  }
  if (REFERENCE.has(attribute)) {
    if (value.trim() === 'none') return 'none'
    const match = REFERENCE_VALUE.exec(value.trim())
    return match?.[1] === undefined ? undefined : reference(match[1])
  }
  if (attribute === 'transform' || attribute === 'gradientTransform') {
    return TRANSFORM_VALUE.test(value) ? value : undefined
  }
  if (attribute === 'font-family') return FONT_FAMILY_VALUE.test(value) ? value : undefined
  if (PLAIN.has(attribute)) return PLAIN_VALUE.test(value) ? value : undefined
  return undefined
}

/**
 * An element's `style` declarations, as the attributes they would be.
 *
 * A page under Quill's CSP cannot carry a `style` attribute, but what one says
 * about paint and geometry is exactly what the same-named presentation
 * attribute says, and in CSS it wins over that attribute. So each declaration
 * this file would keep as an attribute becomes that attribute, overriding one
 * already there; anything else in a `style` is dropped with it.
 */
function styleDeclarations(properties: Properties): ReadonlyMap<string, string> {
  const style = properties['style']
  if (typeof style !== 'string') return new Map()
  return new Map(
    style.split(';').flatMap((declaration) => {
      const colon = declaration.indexOf(':')
      if (colon < 0) return []
      const name = declaration.slice(0, colon).trim().toLowerCase()
      const value = declaration.slice(colon + 1).trim()
      return name === '' || value === '' ? [] : [[name, value] as const]
    }),
  )
}

function sanitizeProperties(properties: Properties, prefix: string): Properties {
  const declared = styleDeclarations(properties)
  const attributes = new Map(
    Object.entries(properties).map(([property, raw]) => [attributeOf(property), text(raw)]),
  )
  // A declaration this file cannot keep leaves the attribute it would have
  // overridden in place: the attribute is the drawing's own fallback for it.
  for (const [name, value] of declared) {
    if (keep(name, value, prefix) !== undefined) attributes.set(name, value)
  }
  return Object.fromEntries(
    [...attributes].flatMap(([attribute, value]) => {
      const kept = keep(attribute, value, prefix)
      return kept === undefined ? [] : [[find(svg, attribute).property, kept]]
    }),
  )
}

interface Budget {
  remaining: number
}

function sanitizeChildren(
  children: readonly (ElementContent | RootContent)[],
  prefix: string,
  budget: Budget,
): ElementContent[] {
  return children.flatMap((child): ElementContent[] => {
    if (child.type === 'text') return [{ type: 'text', value: child.value }]
    if (child.type !== 'element' || !ELEMENTS.has(child.tagName)) return []
    budget.remaining -= 1
    if (budget.remaining < 0) return []
    return [
      {
        type: 'element',
        tagName: child.tagName,
        properties: sanitizeProperties(child.properties, prefix),
        children: sanitizeChildren(child.children, prefix, budget),
      },
    ]
  })
}

/** The drawing's own coordinate system, so it scales by its box rather than a fixed size. */
function viewBoxOf(properties: Properties): string | undefined {
  const declared = properties['viewBox']
  if (declared !== undefined) return text(declared)
  const width = Number(text(properties['width']))
  const height = Number(text(properties['height']))
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? `0 0 ${width} ${height}`
    : undefined
}

/**
 * The drawing, sanitised, as a hast `svg` element ready to be placed in a
 * rendered body; or null when the markup holds no drawing, or one too large
 * to be a diagram.
 */
export function sanitizeDrawing(markup: string, options: DrawingOptions): Element | null {
  const tree = fromHtml(markup, { fragment: true })
  const root = tree.children.find(
    (child): child is Element => child.type === 'element' && child.tagName === 'svg',
  )
  if (root === undefined) return null

  const budget: Budget = { remaining: MAX_ELEMENTS }
  const children = sanitizeChildren(root.children, options.idPrefix, budget)
  if (budget.remaining < 0) return null

  const {
    width: _width,
    height: _height,
    ...kept
  } = sanitizeProperties(root.properties, options.idPrefix)
  const viewBox = viewBoxOf(root.properties)
  return {
    type: 'element',
    tagName: 'svg',
    properties: {
      ...kept,
      ...(viewBox === undefined || !PLAIN_VALUE.test(viewBox) ? {} : { viewBox }),
      role: 'img',
      ariaLabel: options.label.length > 0 ? options.label : 'Diagram',
    },
    children,
  }
}
