import type { Element, Properties } from 'hast'

import type { DrawingRendering } from '../extensions/contract.ts'
import { DATA_ATTRIBUTE } from '../extensions/contract.ts'
import { sanitizeDrawing } from './drawing.ts'

/**
 * A drawing, as the platform draws it, from the rendering an extension chose
 * (`extensions/contract.ts`). This is where an extension's choice becomes
 * markup, so the choices stay the platform's: the SVG allowlist for an inline
 * drawing, a plain `<img>` of the stored file for the other kind, and the
 * granted data attributes on either. Placed into its slot after the
 * document's sanitiser has run (`html.ts`), like every drawing.
 */

export interface DrawingPlacement {
  /** The attachment URL the image names; only ever the application's own (`render-document.ts`). */
  readonly url: string
  readonly idPrefix: string
  /** The image's alternative text. */
  readonly label: string
  /** The organisation's label names, kept as classes in an inline drawing (`drawing.ts`). */
  readonly labels?: ReadonlySet<string> | undefined
}

/** A same-origin path, never a scheme or a protocol-relative address. */
const SAME_ORIGIN_PATH = /^\/(?![/\\])/

/**
 * A rendering's data attributes, and nothing else. The registry has already
 * dropped any its extension's grant does not name (`registry.ts`); this is
 * the last word, so a rendering that reaches here some other way still
 * cannot add a source, a handler, or a role.
 */
function dataOf(rendering: DrawingRendering): Properties {
  return Object.fromEntries(
    Object.entries(rendering.data).filter(([name]) => DATA_ATTRIBUTE.test(name)),
  )
}

/** A number, the only thing a natural size is made of. */
function dimension(value: string | undefined): number | undefined {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

/** The drawing's own size, from its view box, which the allowlist has already checked. */
function naturalSize(svg: Element): Properties {
  const [, , width, height] = String(svg.properties['viewBox'] ?? '').split(/[\s,]+/)
  const w = dimension(width)
  const h = dimension(height)
  return w === undefined || h === undefined ? {} : { width: w, height: h }
}

export function drawingElement(
  rendering: DrawingRendering,
  placement: DrawingPlacement,
): Element | null {
  if (rendering.kind === 'image') {
    if (!SAME_ORIGIN_PATH.test(placement.url)) return null
    return {
      type: 'element',
      tagName: 'img',
      properties: {
        src: placement.url,
        alt: placement.label,
        loading: 'lazy',
        decoding: 'async',
        ...dataOf(rendering),
      },
      children: [],
    }
  }
  const svg = sanitizeDrawing(rendering.markup, {
    idPrefix: placement.idPrefix,
    label: placement.label,
    labels: placement.labels,
  })
  if (svg === null) return null
  return {
    ...svg,
    properties: {
      ...svg.properties,
      ...(rendering.naturalSize ? naturalSize(svg) : {}),
      ...dataOf(rendering),
    },
  }
}
