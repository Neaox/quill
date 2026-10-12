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
  const drawn = <img className={className} src={image.src} alt={alt} />
  if (image.still === undefined) return drawn
  return (
    <picture>
      <source srcSet={image.still} media={REDUCED_MOTION} />
      {drawn}
    </picture>
  )
}
