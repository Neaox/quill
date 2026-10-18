import { Glyph } from './icons.tsx'
import type { IconProps } from './icons.tsx'

/*
 * The table editor's controls (ADR-040): a table's parts, its columns'
 * alignment, and rows and columns going in and out. Drawn on the same
 * 16-unit grid and 1.5-unit stroke as the rest of the set (`icons.tsx`),
 * over one frame — a table of three rows and three columns — so the part a
 * control acts on is the one drawn solid; decorative like every icon, the
 * control that shows one is named in words.
 */

/** The table's frame, shared by the part icons. */
function Frame() {
  return <rect x="2.25" y="2.75" width="11.5" height="10.5" rx="1.25" />
}

/** The header row: the frame's top band filled. */
export function HeaderRowIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <Frame />
      <path d="M2.25 6.25h11.5M6.25 6.25v7M9.75 6.25v7" />
      <path d="M3.25 3.75h9.5v1.75h-9.5z" fill="currentColor" stroke="none" />
    </Glyph>
  )
}

/** The header column: the frame's leading band filled. */
export function HeaderColumnIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <Frame />
      <path d="M5.75 2.75v10.5M5.75 6.25h8M5.75 9.75h8" />
      <path d="M3.25 3.75h1.75v8.5H3.25z" fill="currentColor" stroke="none" />
    </Glyph>
  )
}

/** A footer row: the frame's bottom band filled, under a rule. */
export function FooterRowIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <Frame />
      <path d="M2.25 9.75h11.5M6.25 2.75v7M9.75 2.75v7" />
      <path d="M3.25 10.5h9.5v1.75h-9.5z" fill="currentColor" stroke="none" />
    </Glyph>
  )
}

/** A caption: a line of words over a table. */
export function CaptionIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M2.25 2.75h7" />
      <rect x="2.25" y="5.75" width="11.5" height="7.5" rx="1.25" />
      <path d="M2.25 9.5h11.5M8 5.75v7.5" />
    </Glyph>
  )
}

export function AlignLeftIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M2.75 3.75h10.5M2.75 6.6h6.5M2.75 9.4h10.5M2.75 12.25h6.5" />
    </Glyph>
  )
}

export function AlignCenterIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M2.75 3.75h10.5M4.75 6.6h6.5M2.75 9.4h10.5M4.75 12.25h6.5" />
    </Glyph>
  )
}

export function AlignRightIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M2.75 3.75h10.5M6.75 6.6h6.5M2.75 9.4h10.5M6.75 12.25h6.5" />
    </Glyph>
  )
}

/** A row going in above: a row with a "+" over it. */
export function RowAboveIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <rect x="2.25" y="8.75" width="11.5" height="4.5" rx="1" />
      <path d="M8 2.25v4.5M5.75 4.5h4.5" />
    </Glyph>
  )
}

/** A row going in below: a row with a "+" under it. */
export function RowBelowIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <rect x="2.25" y="2.75" width="11.5" height="4.5" rx="1" />
      <path d="M8 9.25v4.5M5.75 11.5h4.5" />
    </Glyph>
  )
}

/** A column going in on the left: a column with a "+" beside it. */
export function ColumnLeftIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <rect x="8.75" y="2.25" width="4.5" height="11.5" rx="1" />
      <path d="M2.25 8h4.5M4.5 5.75v4.5" />
    </Glyph>
  )
}

/** A column going in on the right. */
export function ColumnRightIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <rect x="2.75" y="2.25" width="4.5" height="11.5" rx="1" />
      <path d="M9.25 8h4.5M11.5 5.75v4.5" />
    </Glyph>
  )
}

/** A row coming out: a row with a cross under it, as the inserting icons have a "+". */
export function DeleteRowIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <rect x="2.25" y="2.75" width="11.5" height="4.5" rx="1" />
      <path d="m6.25 9.75 3.5 3.5M9.75 9.75l-3.5 3.5" />
    </Glyph>
  )
}

/** A column coming out: a column with a cross beside it. */
export function DeleteColumnIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <rect x="2.75" y="2.25" width="4.5" height="11.5" rx="1" />
      <path d="m9.75 6.25 3.5 3.5M13.25 6.25l-3.5 3.5" />
    </Glyph>
  )
}

/** How a table reads: sliders. */
export function TableOptionsIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M2.75 4.5h4M9.75 4.5h3.5M2.75 11.5h7M12.25 11.5h1" />
      <circle cx="8.25" cy="4.5" r="1.5" />
      <circle cx="10.75" cy="11.5" r="1.5" />
    </Glyph>
  )
}
