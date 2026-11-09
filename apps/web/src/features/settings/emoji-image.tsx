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
   * draws it: by reference, in the colour of the text around it. A file not
   * yet saved is shown as the picture it was uploaded as.
   */
  readonly glyph?: { readonly width: number; readonly height: number } | undefined
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
        <use href={`${image.src}#glyph`} width={width} height={height} />
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
