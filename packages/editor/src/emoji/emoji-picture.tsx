import { GLYPH_ID } from '@quill/markdown'

const GLYPH_SUFFIX = `#${GLYPH_ID}`

/**
 * The address a menu shows an organisation's emoji from: its image, or for a
 * monochrome one (ADR-038, amended) its glyph, `…svg#glyph`, so the menu can
 * draw it in the menu's own ink rather than as a black picture.
 */
export function emojiPictureAddress(src: string, monochrome: boolean | undefined): string {
  return monochrome === true ? `${src}${GLYPH_SUFFIX}` : src
}

/** An emoji's picture in a menu, decoration beside its words: an image, or a glyph in the ink. */
export function EmojiPicture({
  image,
  className,
}: {
  readonly image: string
  readonly className: string
}) {
  if (!image.endsWith(GLYPH_SUFFIX)) return <img src={image} alt="" className={className} />
  return (
    <svg className={className} viewBox="0 0 1 1" aria-hidden="true">
      <use href={image} width="1" height="1" />
    </svg>
  )
}
