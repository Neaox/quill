import { fromHtml } from 'hast-util-from-html'
import type { Element, ElementContent, RootContent } from 'hast'
import { find, svg } from 'property-information'

import { GLYPH_ID } from './emoji.ts'

/**
 * A monochrome emoji (ADR-038, amended 2026-11-10): a line icon drawn in the
 * colour of the text around it, as the icons in a product's own interface
 * are — the accent in a timeline's node, grey in a party's chip, ink in a
 * sentence — rather than a picture that keeps its own colours.
 *
 * An organisation asks for it when it uploads an SVG. The SVG is read here,
 * once, and either refused with a reason or rewritten as a glyph: its shapes,
 * and nothing else, in one `<symbol id="glyph">`, painted with
 * `currentColor`. A reader's page draws it with `<svg><use href="…#glyph">`,
 * so the shapes inherit the colour of wherever they are used, in light, dark
 * and forced colours alike, with no style and no script. The file still draws
 * on its own, as an `<img>` in the settings screen, through a `<use>` of its
 * own symbol.
 *
 * What a glyph may hold:
 *
 * - **Shapes only**: `path`, `circle`, `ellipse`, `rect`, `line`, `polyline`,
 *   `polygon`, grouped by `g`. Anything else that draws — text, an image, a
 *   gradient, a filter, a mask, a `use`, a `style` — is refused by name; a
 *   title, a description and metadata are dropped.
 * - **One colour**: every fill and stroke is `none`, `currentColor` or one and
 *   the same colour, which becomes `currentColor`. Two colours are a picture,
 *   and are refused. A shape with no fill of its own fills with the colour, as
 *   SVG's default black would have.
 * - **Plain numbers**: geometry, widths, opacities and transforms are kept only
 *   in their own shapes (numbers, path commands, transform functions). Ids,
 *   classes, links, event handlers and every other attribute are dropped.
 */

export type MonochromeGlyph =
  | {
      readonly kind: 'glyph'
      /** The SVG to store and serve: the shapes as one symbol, and a use of it. */
      readonly svg: string
      /** The drawing's own proportions, from its view box. */
      readonly width: number
      readonly height: number
    }
  | { readonly kind: 'refused'; readonly reason: string }

const SHAPES = new Set(['path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon'])

/** What an icon file carries that is not part of the drawing. */
const DROPPED = new Set(['title', 'desc', 'metadata'])

const NUMBER = /^-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/iu
const NUMBERS = /^[-+\d.eE\s,]+$/u
const PATH = /^[MmZzLlHhVvCcSsQqTtAa\d\s.,eE+-]*$/u
const TRANSFORM =
  /^(?:\s*(?:matrix|translate|scale|rotate|skewX|skewY)\s*\([-+\d.eE\s,]*\)\s*,?)*\s*$/u
const LENGTH = /^(?:-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)(?:px|%)?$/iu

/** Attributes kept on a shape, each with the form its value must have. */
const GEOMETRY: Readonly<Record<string, RegExp>> = {
  d: PATH,
  points: NUMBERS,
  cx: LENGTH,
  cy: LENGTH,
  r: LENGTH,
  rx: LENGTH,
  ry: LENGTH,
  x: LENGTH,
  y: LENGTH,
  x1: LENGTH,
  y1: LENGTH,
  x2: LENGTH,
  y2: LENGTH,
  width: LENGTH,
  height: LENGTH,
  transform: TRANSFORM,
  pathLength: NUMBER,
}

/** Presentation that does not say a colour, kept on any element. */
const PRESENTATION: Readonly<Record<string, RegExp>> = {
  'stroke-width': LENGTH,
  'stroke-linecap': /^(?:butt|round|square)$/u,
  'stroke-linejoin': /^(?:miter|round|bevel|arcs|miter-clip)$/u,
  'stroke-miterlimit': NUMBER,
  'stroke-dasharray': /^(?:none|[-+\d.eE\s,]+)$/u,
  'stroke-dashoffset': LENGTH,
  'fill-rule': /^(?:nonzero|evenodd)$/u,
  'clip-rule': /^(?:nonzero|evenodd)$/u,
  opacity: NUMBER,
  'fill-opacity': NUMBER,
  'stroke-opacity': NUMBER,
}

const PAINT = new Set(['fill', 'stroke'])

class Refusal extends Error {}

function attributeName(property: string): string {
  return find(svg, property).attribute
}

function valueOf(value: unknown): string {
  return Array.isArray(value) ? value.join(' ') : String(value)
}

function escape(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')
}

interface Reading {
  /** The one colour the drawing is in, as written, once one is met. */
  colour: string | undefined
}

/** One colour however it is spelled: `#000`, `#000000` and `black` are one colour. */
function canonicalColour(colour: string): string {
  const named = NAMED[colour]
  if (named !== undefined) return named
  const short = SHORT_HEX.exec(colour)
  return short === null
    ? colour
    : `#${[...short[0].slice(1)].map((digit) => digit + digit).join('')}`
}

const NAMED: Readonly<Record<string, string>> = { black: '#000000', white: '#ffffff' }
const SHORT_HEX = /^#([\da-f]{3,4})$/u

/** A fill or a stroke, as the glyph paints it: nothing, or the context's colour. */
function paint(value: string, reading: Reading): string {
  const written = value.trim()
  const lower = written.toLowerCase()
  if (lower === 'none' || lower === 'transparent') return 'none'
  if (lower === 'currentcolor' || lower === 'inherit') return 'currentColor'
  if (written.includes('url(')) throw new Refusal('it is painted with a gradient or a pattern')
  const colour = canonicalColour(lower)
  if (reading.colour === undefined) reading.colour = colour
  else if (reading.colour !== colour) throw new Refusal('it is drawn in more than one colour')
  return 'currentColor'
}

/** An element's attributes as the glyph writes them, or a refusal. */
function attributesOf(node: Element, kept: Readonly<Record<string, RegExp>>, reading: Reading) {
  const written: [string, string][] = []
  for (const [property, raw] of Object.entries(node.properties)) {
    // hast leaves an attribute it read as absent out, or false for a bare flag.
    /* v8 ignore next */
    if (raw === undefined || raw === null || raw === false) continue
    const name = attributeName(property)
    const value = valueOf(raw)
    if (name === 'style') {
      throw new Refusal('it is styled with a style attribute; write its colours as attributes')
    }
    if (PAINT.has(name)) {
      written.push([name, paint(value, reading)])
      continue
    }
    const form = kept[name] ?? PRESENTATION[name]
    if (form === undefined) continue
    if (!form.test(value.trim())) throw new Refusal(`its ${name} "${value}" is not plain numbers`)
    written.push([name, value.trim()])
  }
  return written
}

function attributeText(attributes: readonly (readonly [string, string])[]): string {
  return attributes.map(([name, value]) => ` ${name}="${escape(value)}"`).join('')
}

function isElement(node: ElementContent | RootContent): node is Element {
  return node.type === 'element'
}

/** A drawing's elements as the glyph's markup, depth first. */
function shapesOf(children: readonly ElementContent[], reading: Reading): string {
  return children
    .filter(isElement)
    .map((child) => {
      if (DROPPED.has(child.tagName)) return ''
      if (child.tagName === 'g') {
        return `<g${attributeText(attributesOf(child, {}, reading))}>${shapesOf(child.children, reading)}</g>`
      }
      if (!SHAPES.has(child.tagName)) {
        throw new Refusal(`it holds <${child.tagName}>, and a glyph holds shapes only`)
      }
      return `<${child.tagName}${attributeText(attributesOf(child, GEOMETRY, reading))}/>`
    })
    .join('')
}

/** The view box a drawing is laid out in: its own, or one its width and height make. */
function viewBoxOf(root: Element): readonly [number, number, number, number] {
  const box = root.properties['viewBox']
  const numbers =
    box === undefined
      ? [
          0,
          0,
          Number.parseFloat(valueOf(root.properties['width'])),
          Number.parseFloat(valueOf(root.properties['height'])),
        ]
      : valueOf(box)
          .trim()
          .split(/[\s,]+/u)
          .map(Number)
  const [x = Number.NaN, y = Number.NaN, width = Number.NaN, height = Number.NaN] = numbers
  if (
    numbers.length !== 4 ||
    ![x, y, width, height].every(Number.isFinite) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new Refusal('it has no view box to draw it at text size')
  }
  return [x, y, width, height]
}

/** Reads an uploaded SVG as a monochrome glyph, or says why it cannot be one. */
export function monochromeGlyph(source: string): MonochromeGlyph {
  try {
    const roots = fromHtml(source, { fragment: true }).children.filter(isElement)
    const [root] = roots
    if (root?.tagName !== 'svg' || roots.length !== 1) {
      throw new Refusal('it is not one SVG drawing')
    }
    const reading: Reading = { colour: undefined }
    const box = viewBoxOf(root)
    // The root's own presentation (`fill="none" stroke="currentColor"`) is
    // carried by a group, and a drawing that says no fill fills with the colour.
    const outer = attributesOf(root, {}, reading)
    const group = outer.some(([name]) => name === 'fill')
      ? outer
      : [['fill', 'currentColor'] as const, ...outer]
    const shapes = shapesOf(root.children, reading)
    if (shapes === '') throw new Refusal('it draws nothing')
    const viewBox = box.join(' ')
    const [, , width, height] = box
    const glyph = [
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${width}" height="${height}">`,
      `<symbol id="${GLYPH_ID}" viewBox="${viewBox}"><g${attributeText(group)}>${shapes}</g></symbol>`,
      `<use href="#${GLYPH_ID}"/>`,
      '</svg>',
    ].join('')
    return {
      kind: 'glyph',
      svg: glyph,
      width: Math.max(1, Math.round(width)),
      height: Math.max(1, Math.round(height)),
    }
  } catch (error) {
    /* v8 ignore else -- only a refusal is expected; anything else is a bug and must surface. */
    if (error instanceof Refusal) return { kind: 'refused', reason: error.message }
    /* v8 ignore next */
    throw error
  }
}
