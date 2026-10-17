import { tv } from '@quill/ui'

import { formatOklch, type Colour } from '@quill/theme'

import { paintProperties } from '../custom-properties.ts'

/**
 * The doctor's specimens: the thing a rule measured, drawn in exactly the
 * colours it measured, at the size of a word.
 *
 * A contrast pair is drawn as what it is on a page — body text on its
 * surface, a link, a button, a focus ring, a badge, a token in a code block
 * — because "4.6:1" means little and a faint link on a grey panel means a
 * lot. A single colour is drawn as a chip. Both are painted through two
 * custom properties rather than the page's tokens, since the colours are a
 * theme still being edited, or one the generator would have produced.
 */

export type SpecimenKind =
  | 'text'
  | 'meta'
  | 'link'
  | 'button'
  | 'focus'
  | 'border'
  | 'badge'
  | 'code'
  | 'placeholder'

const KIND_BY_ROLE: Readonly<Record<string, SpecimenKind>> = {
  muted: 'meta',
  accent: 'link',
  accentInk: 'link',
  accentForeground: 'button',
  focusRing: 'focus',
  borderStrong: 'border',
  success: 'badge',
  warning: 'badge',
  danger: 'badge',
  placeholder: 'placeholder',
}

/** How a foreground role is drawn: a syntax colour as code, anything unnamed as text. */
export function specimenKind(foreground: string): SpecimenKind {
  return KIND_BY_ROLE[foreground] ?? (foreground.startsWith('token-') ? 'code' : 'text')
}

const SPECIMEN_WORDS: Readonly<Record<SpecimenKind, string>> = {
  text: 'Aa Reading',
  meta: 'Updated today',
  link: 'Read the guide',
  button: 'Publish',
  focus: 'Focused',
  border: 'Field',
  badge: 'Status',
  code: 'const',
  placeholder: 'Search…',
}

export const specimenStyles = tv({
  slots: {
    ground: [
      'inline-flex h-8 min-w-24 items-center justify-center rounded-sm px-2.5',
      'border border-border bg-(--specimen-bg) whitespace-nowrap',
    ],
    mark: 'text-xs leading-none text-(--specimen-fg)',
  },
  variants: {
    kind: {
      text: { mark: 'font-medium' },
      meta: {},
      link: { mark: 'underline decoration-1 underline-offset-2' },
      button: { mark: 'font-medium', ground: 'rounded-md' },
      focus: {
        mark: 'rounded-sm px-2 py-1 text-foreground outline-2 outline-offset-1 outline-(--specimen-fg)',
      },
      border: { mark: 'rounded-sm border border-(--specimen-fg) px-2 py-1 text-muted' },
      badge: { mark: 'font-mono text-2xs tracking-caps uppercase' },
      code: { mark: 'font-mono' },
      placeholder: { mark: 'italic' },
    },
  },
})

export interface PairSpecimenProps {
  readonly foreground: Colour
  readonly background: Colour
  readonly kind: SpecimenKind
}

/**
 * A foreground on its background, drawn as the thing it is on a page. The
 * specimen is decorative to assistive technology: the row it sits in names
 * the pair and states the measurement in words.
 */
export function PairSpecimen({ foreground, background, kind }: PairSpecimenProps) {
  const styles = specimenStyles({ kind })
  return (
    <span
      aria-hidden="true"
      ref={paintProperties({
        '--specimen-fg': formatOklch(foreground),
        '--specimen-bg': formatOklch(background),
      })}
      className={styles.ground()}
    >
      <span className={styles.mark()}>{SPECIMEN_WORDS[kind]}</span>
    </span>
  )
}

export const chipStyles = tv({
  slots: {
    ground: [
      'inline-flex shrink-0 items-center rounded-sm border border-border',
      'bg-(--specimen-ground) p-1.5',
    ],
    chip: 'inline-flex shrink-0 items-center rounded-sm bg-(--specimen-bg)',
    words: 'px-2 text-2xs leading-6 font-medium whitespace-nowrap text-(--specimen-ink)',
  },
  variants: {
    /** Straight on the settings page, with no surface of its own: it needs an edge. */
    onPage: { true: { chip: 'border border-border' } },
    /** A colour with no text on it: a square. */
    bare: { true: { chip: 'size-5' } },
  },
})

export interface ColourChipProps {
  readonly colour: Colour
  /** The surface the colour sits on, for a surface or a wash. */
  readonly ground?: Colour | undefined
  /** The text set on it: a wash is judged as it is read, behind words. */
  readonly ink?: Colour | undefined
}

/**
 * One colour: a bare chip for a mark or a line; for a surface or a wash, the
 * colour on the surface it sits on with a word set on it, because that is
 * how its feel is judged — a dark wash that looks grey as a square can still
 * read as teal behind text, and the other way about.
 */
export function ColourChip({ colour, ground, ink }: ColourChipProps) {
  const styles = chipStyles({ onPage: ground === undefined, bare: ink === undefined })
  const chip = (
    <span
      aria-hidden="true"
      ref={paintProperties({
        '--specimen-bg': formatOklch(colour),
        ...(ink === undefined ? {} : { '--specimen-ink': formatOklch(ink) }),
      })}
      className={styles.chip()}
    >
      {ink === undefined ? undefined : <span className={styles.words()}>Runbook</span>}
    </span>
  )
  if (ground === undefined) return chip
  return (
    <span
      aria-hidden="true"
      ref={paintProperties({ '--specimen-ground': formatOklch(ground) })}
      className={styles.ground()}
    >
      {chip}
    </span>
  )
}
