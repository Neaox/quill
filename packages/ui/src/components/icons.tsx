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

function Glyph({ className, children }: IconProps & { readonly children: ReactNode }) {
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

export function CloseIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="m4 4 8 8M12 4l-8 8" />
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
