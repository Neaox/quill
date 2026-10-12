import { Glyph } from './icons.tsx'
import type { IconProps } from './icons.tsx'

/*
 * The icons of the table editor's toolbar, on the same 16-unit grid and
 * 1.5-unit stroke as the rest of the set (`icons.tsx`) and decorative in the
 * same way: the button that shows one names itself in words.
 *
 * The insert icons share one drawing, a table with one line picked out by a
 * plus, so the four read as a family and differ only in where the plus is.
 */

/** Text set against the left edge. */
export function AlignLeftIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M2.5 3.5h11M2.5 6.5h7M2.5 9.5h11M2.5 12.5h7" />
    </Glyph>
  )
}

export function AlignCenterIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M2.5 3.5h11M4.5 6.5h7M2.5 9.5h11M4.5 12.5h7" />
    </Glyph>
  )
}

export function AlignRightIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M2.5 3.5h11M6.5 6.5h7M2.5 9.5h11M6.5 12.5h7" />
    </Glyph>
  )
}

/** A row added above the selected one. */
export function RowAboveIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <rect x="2.25" y="8.25" width="11.5" height="5.5" rx="1.25" />
      <path d="M8 2v4M6 4h4" />
    </Glyph>
  )
}

export function RowBelowIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <rect x="2.25" y="2.25" width="11.5" height="5.5" rx="1.25" />
      <path d="M8 10v4M6 12h4" />
    </Glyph>
  )
}

export function ColumnLeftIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <rect x="8.25" y="2.25" width="5.5" height="11.5" rx="1.25" />
      <path d="M2 8h4M4 6v4" />
    </Glyph>
  )
}

export function ColumnRightIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <rect x="2.25" y="2.25" width="5.5" height="11.5" rx="1.25" />
      <path d="M10 8h4M12 6v4" />
    </Glyph>
  )
}

export function ArrowUpIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M8 13V3M3.75 7.25 8 3l4.25 4.25" />
    </Glyph>
  )
}

export function ArrowDownIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M8 3v10M3.75 8.75 8 13l4.25-4.25" />
    </Glyph>
  )
}

export function ArrowLeftIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M13 8H3M7.25 3.75 3 8l4.25 4.25" />
    </Glyph>
  )
}

export function ArrowRightIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M3 8h10M8.75 3.75 13 8l-4.25 4.25" />
    </Glyph>
  )
}

/** Two sliders: the options a thing has, as settings apps draw them. */
export function OptionsIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M2.5 5h6M11.5 5h2M2.5 11h2M7.5 11h6" />
      <circle cx="10" cy="5" r="1.5" />
      <circle cx="6" cy="11" r="1.5" />
    </Glyph>
  )
}

export function TrashIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M2.75 4.25h10.5M6.25 4.25V2.75h3.5v1.5M4.25 4.25l.55 8.5a1 1 0 0 0 1 .94h4.4a1 1 0 0 0 1-.94l.55-8.5M6.75 7v3.75M9.25 7v3.75" />
    </Glyph>
  )
}
