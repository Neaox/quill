import { Glyph } from './icons.tsx'
import type { IconProps } from './icons.tsx'

/*
 * The marks a writer puts on words, for the editor's selection toolbar and its
 * context menu. Drawn on the same 16-unit grid and 1.5-unit stroke as the rest
 * of the set (`icons.tsx`), and decorative in the same way: every control that
 * shows one is named in words.
 */

export function BoldIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M4.75 2.75h4a2.6 2.6 0 0 1 0 5.2h-4zM4.75 7.95h4.75a2.65 2.65 0 0 1 0 5.3H4.75z" />
    </Glyph>
  )
}

export function ItalicIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M6.75 2.75h5M4.25 13.25h5M9.5 2.75l-3 10.5" />
    </Glyph>
  )
}

export function StrikeIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M2.75 8h10.5" />
      <path d="M11.25 4.5c-.5-1.1-1.75-1.75-3.25-1.75-1.9 0-3.25 1-3.25 2.5 0 .9.45 1.55 1.2 2" />
      <path d="M10.6 10c.4.4.65.9.65 1.5 0 1.55-1.45 2.5-3.35 2.5-1.6 0-2.9-.7-3.4-1.85" />
    </Glyph>
  )
}

export function InlineCodeIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="m5.25 4.75-3.5 3.25 3.5 3.25M10.75 4.75l3.5 3.25-3.5 3.25" />
    </Glyph>
  )
}

/** Clear formatting: a T with a stroke through it. */
export function ClearFormattingIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M3.25 3.25h8M7.25 3.25 5.5 12.75" />
      <path d="m9.75 9.75 3.5 3.5M13.25 9.75l-3.5 3.5" />
    </Glyph>
  )
}

/** Turn into: one block becoming another. */
export function TurnIntoIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M2.75 5.25h7.5l-2-2M13.25 10.75h-7.5l2 2" />
    </Glyph>
  )
}

/** A link that has been taken off: two links apart. */
export function UnlinkIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M6.5 4.25 7.6 3.15a2.75 2.75 0 0 1 3.9 3.9L10.4 8.15" />
      <path d="M9.5 11.75 8.4 12.85a2.75 2.75 0 0 1-3.9-3.9l1.1-1.1" />
      <path d="M2.75 2.75 4.5 4.5M11.5 11.5l1.75 1.75" />
    </Glyph>
  )
}

/** Cut: a pair of scissors. */
export function CutIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <circle cx="4.25" cy="11.5" r="1.75" />
      <circle cx="11.75" cy="11.5" r="1.75" />
      <path d="M5.5 10.25 12.25 2.75M10.5 10.25 3.75 2.75" />
    </Glyph>
  )
}

/** Paste: a clipboard. */
export function PasteIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M5.75 2.75h4.5v2h-4.5z" />
      <path d="M10.25 3.75h1.5a1 1 0 0 1 1 1v8.5a1 1 0 0 1-1 1h-7.5a1 1 0 0 1-1-1v-8.5a1 1 0 0 1 1-1h1.5" />
    </Glyph>
  )
}

export function TrashIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M2.75 4.25h10.5M6.25 4.25v-1.5h3.5v1.5M4.25 4.25l.6 9h6.3l.6-9" />
    </Glyph>
  )
}

export function ArrowUpIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M8 13.25V2.75M3.75 7 8 2.75 12.25 7" />
    </Glyph>
  )
}

export function ArrowDownIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M8 2.75v10.5M3.75 9 8 13.25 12.25 9" />
    </Glyph>
  )
}
