import type { ReactNode } from 'react'

function Glyph({ children }: { readonly children: ReactNode }) {
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
      className="size-4 shrink-0"
    >
      {children}
    </svg>
  )
}

export function PublishIcon() {
  return (
    <Glyph>
      <path d="M8 13V3.5" />
      <path d="m4.5 7 3.5-3.5L11.5 7" />
      <path d="M3 13.2h10" />
    </Glyph>
  )
}

export function HistoryIcon() {
  return (
    <Glyph>
      <path d="M2.4 8a5.6 5.6 0 1 0 1.7-4" />
      <path d="M2.2 2.4v2.4h2.4" />
      <path d="M8 5.2V8l2 1.3" />
    </Glyph>
  )
}

export function ExternalIcon() {
  return (
    <Glyph>
      <path d="M9.2 3.2h3.6v3.6" />
      <path d="M12.8 3.2 7.6 8.4" />
      <path d="M11.4 9.6v2.4a1.4 1.4 0 0 1-1.4 1.4H4a1.4 1.4 0 0 1-1.4-1.4V6a1.4 1.4 0 0 1 1.4-1.4h2.4" />
    </Glyph>
  )
}
