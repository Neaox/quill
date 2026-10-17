import type { ReactNode } from 'react'

import { cx } from '../lib/class-names.ts'

export interface IconProps {
  readonly className?: string | undefined
}

/*
 * The icons the primitives and the signature components need, drawn on a
 * 16-unit grid with a 1.5-unit stroke so they sit optically level with text at
 * any size. They are always decorative: the component that uses one supplies
 * the words.
 */

export function Glyph({ className, children }: IconProps & { readonly children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={cx('size-4 shrink-0', className)}
    >
      {children}
    </svg>
  )
}

export function InfoIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 7.25v3.75" />
      <path d="M8 5.1v.1" />
    </Glyph>
  )
}

export function SuccessIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <circle cx="8" cy="8" r="6.25" />
      <path d="m5.4 8.2 1.8 1.8 3.4-3.9" />
    </Glyph>
  )
}

export function WarningIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M8 2.3 14.3 13H1.7L8 2.3Z" />
      <path d="M8 6.6v2.9" />
      <path d="M8 11.2v.1" />
    </Glyph>
  )
}

export function DangerIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <circle cx="8" cy="8" r="6.25" />
      <path d="m6 6 4 4M10 6l-4 4" />
    </Glyph>
  )
}

export function ChevronRightIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="m6.25 3.5 4.5 4.5-4.5 4.5" />
    </Glyph>
  )
}

export function ChevronDownIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="m3.5 6.25 4.5 4.5 4.5-4.5" />
    </Glyph>
  )
}

export function CheckIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="m3.5 8.4 2.9 2.9 6.1-6.6" />
    </Glyph>
  )
}

export function CloseIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="m4 4 8 8M12 4l-8 8" />
    </Glyph>
  )
}

/** A sidebar beside a page: the phone's way to the document tree. */
export function SidebarIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <rect x="2.25" y="2.75" width="11.5" height="10.5" rx="1.75" />
      <path d="M6.25 2.75v10.5" />
    </Glyph>
  )
}

/** The rail's outline view: the document tree. */
export function OutlineIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M2.75 3.5h10.5M2.75 8h6.75M2.75 12.5h8.5" />
    </Glyph>
  )
}

export function SearchIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <circle cx="7.25" cy="7.25" r="4.5" />
      <path d="m10.75 10.75 2.5 2.5" />
    </Glyph>
  )
}

export function HistoryIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.6V8l2.2 1.4" />
    </Glyph>
  )
}

export function CommentIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M13.5 8a5.5 5.5 0 0 1-7.9 4.95L2.5 13.5l.95-3.1A5.5 5.5 0 1 1 13.5 8Z" />
    </Glyph>
  )
}

export function CopyIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <rect x="5.75" y="5.75" width="7.5" height="7.5" rx="1.25" />
      <path d="M10.25 3.6A1.35 1.35 0 0 0 9 2.75H4A1.25 1.25 0 0 0 2.75 4v5c0 .58.37 1.08.85 1.25" />
    </Glyph>
  )
}

/** Adding something: a new document, a new collection. */
export function PlusIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M8 3.25v9.5M3.25 8h9.5" />
    </Glyph>
  )
}

/** Changing what is read into what is written: the editor. */
export function PencilIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M10.6 2.9a1.6 1.6 0 0 1 2.27 2.27L5.6 12.45 2.75 13.25l.8-2.85L10.6 2.9Z" />
      <path d="m9.5 4 2.5 2.5" />
    </Glyph>
  )
}

/** Presenting: a screen on a stand. */
export function PresentIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <rect x="2.25" y="2.75" width="11.5" height="7.5" rx="1.25" />
      <path d="M8 10.25v3M5.5 13.25h5" />
    </Glyph>
  )
}

/** Previewing as a reader: an eye, for seeing a page as somebody else will. */
export function PreviewIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M1.75 8s2.25-4.25 6.25-4.25S14.25 8 14.25 8 12 12.25 8 12.25 1.75 8 1.75 8Z" />
      <circle cx="8" cy="8" r="1.75" />
    </Glyph>
  )
}

/** Sharing: a person with a plus beside them, for granting access. */
export function ShareIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <circle cx="6.25" cy="5.5" r="2.5" />
      <path d="M1.75 13.25c.5-2.3 2.3-3.75 4.5-3.75s4 1.45 4.5 3.75M12.5 5v4M10.5 7h4" />
    </Glyph>
  )
}

/** A document: a page with a folded corner. */
export function DocumentIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M4 2.75h5l3 3v7.5H4Z" />
      <path d="M9 2.75v3h3M6 9h4M6 11h2.5" />
    </Glyph>
  )
}

/** A collection: a folder of documents. */
export function CollectionIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M2.25 4.5c0-.7.55-1.25 1.25-1.25h2.6l1.4 1.5h5c.7 0 1.25.55 1.25 1.25v5.75c0 .7-.55 1.25-1.25 1.25h-9c-.7 0-1.25-.55-1.25-1.25Z" />
    </Glyph>
  )
}

/** A link to an address: two links of a chain. */
export function LinkIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M6.75 9.25a2.6 2.6 0 0 0 3.7 0l2.05-2.05a2.6 2.6 0 0 0-3.7-3.7l-.85.85" />
      <path d="M9.25 6.75a2.6 2.6 0 0 0-3.7 0L3.5 8.8a2.6 2.6 0 0 0 3.7 3.7l.85-.85" />
    </Glyph>
  )
}

/** Leaving this site: an arrow out of the corner. */
export function ExternalIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M6.5 3.25h-2.25c-.55 0-1 .45-1 1v7.5c0 .55.45 1 1 1h7.5c.55 0 1-.45 1-1V9.5M9 3.25h3.75V7M12.5 3.5 7.25 8.75" />
    </Glyph>
  )
}

/** A dropdown: a list that opens under its label. */
export function DropdownIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <rect x="2.25" y="2.75" width="11.5" height="3.5" rx="1" />
      <path d="M4.5 9.25h7M4.5 12h5" />
    </Glyph>
  )
}

/** Two versions side by side: a page split down the middle, one half marked. */
export function CompareIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <rect x="2.25" y="2.75" width="11.5" height="10.5" rx="1.25" />
      <path d="M8 2.75v10.5M4.5 6h1.75M4.5 8.5h1.75M9.75 6h1.75M9.75 8.5h1.75M9.75 11h1" />
    </Glyph>
  )
}

/** Exchange two things: one arrow each way. */
export function SwapIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M3 5.5h9.5M10 3l2.5 2.5L10 8M13 10.5H3.5M6 8l-2.5 2.5L6 13" />
    </Glyph>
  )
}

export function ChevronUpIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="m3.5 9.75 4.5-4.5 4.5 4.5" />
    </Glyph>
  )
}

/** Put an earlier version back: an arrow turning back on itself. */
export function RestoreIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M3.25 8a4.75 4.75 0 1 0 1.4-3.35L3.25 6.1" />
      <path d="M3.25 3.25V6.1H6.1" />
    </Glyph>
  )
}
