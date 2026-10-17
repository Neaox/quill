import type { ReactNode } from 'react'

interface GlyphProps {
  /** The scheme it stands for, as an attribute, so what is drawn can be told from what it means. */
  readonly scheme: 'system' | 'light' | 'dark'
  readonly children: ReactNode
}

function Glyph({ scheme, children }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-scheme={scheme}
      className="size-4 shrink-0"
    >
      {children}
    </svg>
  )
}

export function SunIcon() {
  return (
    <Glyph scheme="light">
      <circle cx="8" cy="8" r="3.1" />
      <path d="M8 1.4v1.4M8 13.2v1.4M1.4 8h1.4M13.2 8h1.4M3.4 3.4l1 1M11.6 11.6l1 1M12.6 3.4l-1 1M4.4 11.6l-1 1" />
    </Glyph>
  )
}

export function MoonIcon() {
  return (
    <Glyph scheme="dark">
      <path d="M13.4 9.6A5.8 5.8 0 0 1 6.4 2.6a5.9 5.9 0 1 0 7 7Z" />
    </Glyph>
  )
}

export function SystemIcon() {
  return (
    <Glyph scheme="system">
      <rect x="1.8" y="2.8" width="12.4" height="8.4" rx="1.4" />
      <path d="M5.6 14h4.8M8 11.2V14" />
    </Glyph>
  )
}
