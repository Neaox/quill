import { cx } from '../lib/class-names.ts'

/**
 * A person's initials in a small disc (`byline-avatar` in
 * `@quill/design-css/byline.css`, so the public site draws the same one).
 *
 * Quill stores no pictures of people, and initials are what Confluence and
 * Linear fall back to anyway. The avatar is decoration beside a name that is
 * always written out, so it is hidden from assistive technology rather than
 * read twice.
 */

const words = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** The first character a reader sees, of a word that has at least one. */
function firstGrapheme(value: string): string {
  const [first] = words.segment(value)
  /* v8 ignore next -- only ever given a word split out of a name, never an empty one. */
  return first === undefined ? '' : first.segment.toLocaleUpperCase()
}

/** "Alex Chen" is AC, "Mary Ann de la Cruz" is MC, `sre@example.com` is S. */
export function initialsOf(name: string): string {
  const local = name.includes('@') ? name.slice(0, name.indexOf('@')) : name
  const parts = local
    .trim()
    .split(/\s+/u)
    .filter((part) => part.length > 0)
  const first = parts[0]
  if (first === undefined) return '?'
  const last = parts.length > 1 ? parts.at(-1) : undefined
  return `${firstGrapheme(first)}${last === undefined ? '' : firstGrapheme(last)}`
}

export interface AvatarProps {
  readonly name: string
  readonly className?: string | undefined
}

export function Avatar({ name, className }: AvatarProps) {
  return (
    <span aria-hidden="true" className={cx('byline-avatar', className)}>
      {initialsOf(name)}
    </span>
  )
}
