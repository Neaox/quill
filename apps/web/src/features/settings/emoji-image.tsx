import { createElement, type ReactElement } from 'react'

/**
 * The query an animation's still is offered under: `@quill/markdown`'s
 * `REDUCED_MOTION`, restated rather than imported so this screen's chunk does
 * not take the Markdown pipeline with it for one string.
 */
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

/** Where a saved emoji is served, and — for an animation — its still (ADR-038, ADR-047). */
export interface ServedEmoji {
  readonly src: string
  readonly still?: string | undefined
  /**
   * A monochrome emoji's served glyph (ADR-038, amended), drawn as the reader
   * draws it: by reference, in the colour of the text around it. One not yet
   * saved, and so not yet served, is drawn from the glyph its upload answered
   * with (`markup`), which the server has already read and rewritten, so the
   * preview is what readers will get.
   */
  readonly glyph?:
    | { readonly width: number; readonly height: number; readonly markup?: string | undefined }
    | undefined
}

/** The elements a glyph is made of (`@quill/markdown`'s `monochromeGlyph`), and nothing else. */
const GLYPH_ELEMENTS: ReadonlySet<string> = new Set([
  'g',
  'path',
  'circle',
  'ellipse',
  'rect',
  'line',
  'polyline',
  'polygon',
])

/** The attributes a glyph's elements carry: geometry, and paint that is the colour around it. */
const GLYPH_ATTRIBUTES: ReadonlySet<string> = new Set([
  'd',
  'points',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'width',
  'height',
  'transform',
  'pathLength',
  'fill',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-dasharray',
  'stroke-dashoffset',
  'fill-rule',
  'clip-rule',
  'opacity',
  'fill-opacity',
  'stroke-opacity',
])

/** A presentation attribute's name as React writes it: `stroke-width` is `strokeWidth`. */
function propName(attribute: string): string {
  return attribute.replaceAll(/-([a-z])/gu, (_, letter: string) => letter.toUpperCase())
}

/** One of a glyph's elements, as React elements, its children with it; anything else is left out. */
function shape(element: Element, key: number): ReactElement | null {
  if (!GLYPH_ELEMENTS.has(element.localName)) return null
  const props: Record<string, string | number> = { key }
  for (const attribute of element.attributes) {
    if (GLYPH_ATTRIBUTES.has(attribute.name)) props[propName(attribute.name)] = attribute.value
  }
  return createElement(element.localName, props, ...[...element.children].map(shape))
}

/**
 * A glyph's shapes drawn in place, from the stored file's own text: the
 * server has already read and rewritten it, and only a glyph's elements and
 * attributes are taken from it again here, so nothing else could be drawn.
 */
function GlyphShapes({ markup }: { readonly markup: string }) {
  const glyph = new DOMParser().parseFromString(markup, 'image/svg+xml').querySelector('symbol')
  return glyph === null ? null : <>{[...glyph.children].map(shape)}</>
}

export interface EmojiImageProps {
  readonly image: ServedEmoji
  readonly alt: string
  readonly className: string
}

/**
 * An emoji as the reader draws it (`@quill/markdown`'s `emojiElement`): an
 * image, or for an animation the same image inside a `picture` that offers
 * its still under reduced motion, so a settings preview moves exactly when a
 * document would.
 */
export function EmojiImage({ image, alt, className }: EmojiImageProps) {
  if (image.glyph !== undefined) {
    const { width, height } = image.glyph
    return (
      <svg
        className={className}
        viewBox={`0 0 ${String(width)} ${String(height)}`}
        {...(alt === '' ? { 'aria-hidden': true } : { role: 'img', 'aria-label': alt })}
      >
        {image.glyph.markup === undefined ? (
          <use href={`${image.src}#glyph`} width={width} height={height} />
        ) : (
          <GlyphShapes markup={image.glyph.markup} />
        )}
      </svg>
    )
  }
  const drawn = <img className={className} src={image.src} alt={alt} />
  if (image.still === undefined) return drawn
  return (
    <picture>
      <source srcSet={image.still} media={REDUCED_MOTION} />
      {drawn}
    </picture>
  )
}
