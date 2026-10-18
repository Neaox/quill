import { Glyph } from './icons.tsx'
import type { IconProps } from './icons.tsx'

/*
 * The kinds of block a document is made of, for the editor's insert menu and
 * anywhere else a block is named by its kind. Drawn on the same 16-unit grid
 * and 1.5-unit stroke as the rest of the set (`icons.tsx`), and decorative in
 * the same way: whatever shows one also says the block's name in words.
 */

/** A plain paragraph: a pilcrow. */
export function ParagraphIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M10.75 2.75v10.5M8 2.75v10.5M12.75 2.75H7a3 3 0 0 0 0 6h1" />
    </Glyph>
  )
}

/** The letter H, which every heading glyph shares. */
const H = 'M2.25 4.25v7.5M6.75 4.25v7.5M2.25 8h4.5'

export function Heading1Icon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d={H} />
      <path d="m10.25 5.75 1.75-1.5v7.5" />
    </Glyph>
  )
}

export function Heading2Icon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d={H} />
      <path d="M9.75 5.6a1.75 1.75 0 0 1 3.4.6c0 1.6-3.4 3.2-3.4 5.55h3.5" />
    </Glyph>
  )
}

export function Heading3Icon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d={H} />
      <path d="M9.75 4.25h3.25l-1.75 2.6a1.9 1.9 0 1 1-1.5 3.1" />
    </Glyph>
  )
}

export function Heading4Icon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d={H} />
      <path d="M12.5 11.75v-7.5L9.5 9.25h4" />
    </Glyph>
  )
}

export function BulletListIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M6.25 4.25h7.5M6.25 8h7.5M6.25 11.75h7.5" />
      <path d="M2.75 4.25h.01M2.75 8h.01M2.75 11.75h.01" strokeWidth="2" />
    </Glyph>
  )
}

export function NumberedListIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M6.75 4.25h7M6.75 8h7M6.75 11.75h7" />
      <path d="m2.25 3.5 1-.75V6M2.25 9.6a1 1 0 0 1 1.9.4c0 .7-1.9 1.4-1.9 2.75h2" />
    </Glyph>
  )
}

export function TaskListIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <rect x="2.25" y="2.75" width="4" height="4" rx="0.75" />
      <path d="m2.5 11 1.25 1.25L6.25 9.5M8.75 4.75h5M8.75 11h5" />
    </Glyph>
  )
}

export function QuoteIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M3.25 3v10M6.75 5h6.5M6.75 8h6.5M6.75 11h4" />
    </Glyph>
  )
}

/** A divider: a rule between two lines of text. */
export function DividerIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M2.25 8h11.5" />
      <path d="M4.25 4h7.5M4.25 12h7.5" strokeOpacity="0.45" />
    </Glyph>
  )
}

/** A callout: a box with a marker down its leading edge. */
export function CalloutIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <rect x="2.25" y="3.25" width="11.5" height="9.5" rx="1.25" />
      <path d="M5 5.75v4.5M7.5 6.5h3.75M7.5 9.5h2.5" />
    </Glyph>
  )
}

/** A details: a row with a chevron opening onto the lines it holds. */
export function DetailsIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="m3 3.75 1.75 1.5L3 6.75M7 5.25h6.25M5.5 9.25h7.75M5.5 12.25h5.25" />
    </Glyph>
  )
}

/** An accordion: three rows, one open. */
export function AccordionIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M2.25 3.25h11.5M2.25 6.25h11.5M4.5 8.75h7M4.5 10.75h5M2.25 13.25h11.5" />
    </Glyph>
  )
}

/** A figure: a picture with its caption underneath. */
export function FigureIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <rect x="2.25" y="2.25" width="11.5" height="8" rx="1" />
      <path d="m4.5 8.25 2.25-2.5 2 2 1.25-1.25 1.5 1.75M4.5 13.25h7" />
    </Glyph>
  )
}

/** Cards: two panels side by side. */
export function CardsIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <rect x="1.75" y="3.25" width="5.5" height="9.5" rx="1" />
      <rect x="8.75" y="3.25" width="5.5" height="9.5" rx="1" />
    </Glyph>
  )
}

/** A block's width: arrows pushing out to the margins. */
export function WidthIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M1.75 3v10M14.25 3v10M4.5 8h7M6.25 6.25 4.5 8l1.75 1.75M9.75 6.25 11.5 8l-1.75 1.75" />
    </Glyph>
  )
}

/** Presenter notes: a speech bubble with lines in it. */
export function NotesIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M2.75 3.25h10.5v7.5H7l-3 2.5v-2.5H2.75Z" />
      <path d="M5.25 6h5.5M5.25 8h3.5" />
    </Glyph>
  )
}

/** An image: a frame with a hill and a sun. */
export function ImageIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <rect x="2.25" y="2.75" width="11.5" height="10.5" rx="1.25" />
      <circle cx="5.75" cy="6.25" r="1.1" />
      <path d="m2.5 11.5 3.5-3.25 2.5 2.25 1.75-1.5 3.25 2.75" />
    </Glyph>
  )
}

/** A diagram: three boxes joined by arrows, as a Mermaid flowchart draws. */
export function DiagramIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <rect x="1.75" y="2.25" width="4.5" height="3.5" rx="0.75" />
      <rect x="9.75" y="2.25" width="4.5" height="3.5" rx="0.75" />
      <rect x="5.75" y="10.25" width="4.5" height="3.5" rx="0.75" />
      <path d="M6.25 4h3.5M4 5.75v2.5h4v2M12 5.75v2.5H8" />
    </Glyph>
  )
}

/** A drawing: a pen nib over a curve. */
export function DrawingIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M2.25 12.5c2-3.5 4-4.75 6-3.25" />
      <path d="m9.25 9.75 4.5-4.5-2-2-4.5 4.5-.5 2.5Z" />
    </Glyph>
  )
}

/** Code: angle brackets. */
export function CodeIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M5.25 4.5 1.75 8l3.5 3.5M10.75 4.5l3.5 3.5-3.5 3.5M9 3 7 13" />
    </Glyph>
  )
}

/** A code group (ADR-041): a code card with tabs along its top. */
export function CodeGroupIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <rect x="1.75" y="4.75" width="12.5" height="8.5" rx="1.25" />
      <path d="M1.75 6V3.5a.75.75 0 0 1 .75-.75h3.25L7 4.75M6 7.75 4.75 9 6 10.25M10 7.75 11.25 9 10 10.25" />
    </Glyph>
  )
}

export function TableIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <rect x="2.25" y="2.75" width="11.5" height="10.5" rx="1.25" />
      <path d="M2.25 6.25h11.5M2.25 9.75h11.5M6.25 6.25v7" />
    </Glyph>
  )
}

/** A status badge: a pill with a dot. */
export function BadgeIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <rect x="1.75" y="5" width="12.5" height="6" rx="3" />
      <path d="M4.75 8h.01" strokeWidth="2" />
      <path d="M7.25 8h4.25" />
    </Glyph>
  )
}

/** A label: a tag on a string. */
export function LabelIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M2.75 2.75h5l5.5 5.5-5 5-5.5-5.5Z" />
      <circle cx="5.5" cy="5.5" r="0.9" />
    </Glyph>
  )
}

/** An emoji: a smiling face. */
export function EmojiIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M5.5 9.5a3 3 0 0 0 5 0M6 6.25h.01M10 6.25h.01" />
    </Glyph>
  )
}

/** A footnote: a line of text and a raised mark. */
export function FootnoteIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M2.25 11.75h7.5M2.25 8.25h5.5M12.25 2.75v4.5M10.75 4h1.5" />
    </Glyph>
  )
}

/** Small print: a large letter beside a small one. */
export function SmallPrintIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M2 12.5 5 3.5l3 9M3 9.75h4M10 12.5l1.75-5 1.75 5M10.6 11h2.3" />
    </Glyph>
  )
}

/** A keyboard key. */
export function KeyboardIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <rect x="1.75" y="4.25" width="12.5" height="7.5" rx="1.25" />
      <path d="M4.25 6.75h.01M6.75 6.75h.01M9.25 6.75h.01M11.75 6.75h.01M5 9.25h6" />
    </Glyph>
  )
}

/** A template placeholder: a dashed box waiting to be filled. */
export function PlaceholderIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <rect x="2.25" y="3.25" width="11.5" height="9.5" rx="1.25" strokeDasharray="2 2" />
    </Glyph>
  )
}

/** Guidance for the author: a light bulb. */
export function GuidanceIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M6 11.25c0-1.5-2-2.5-2-5a4 4 0 0 1 8 0c0 2.5-2 3.5-2 5ZM6.5 13.5h3" />
    </Glyph>
  )
}

/** An optional section: a box with a plus, offered rather than present. */
export function OptionalIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <rect x="2.25" y="2.75" width="11.5" height="10.5" rx="1.25" strokeDasharray="2 2" />
      <path d="M8 5.75v4.5M5.75 8h4.5" />
    </Glyph>
  )
}

/** A repeating section: two arrows chasing each other. */
export function RepeatIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M2.75 7.25V6.5a2.25 2.25 0 0 1 2.25-2.25h7.5M10.75 2.5l1.75 1.75L10.75 6M13.25 8.75v.75a2.25 2.25 0 0 1-2.25 2.25H3.5M5.25 13.5 3.5 11.75 5.25 10" />
    </Glyph>
  )
}

/** A table of contents: entries at two depths, each with its leader dot. */
export function TableOfContentsIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M2.75 3.75h.01M5.75 3.75h7.5M5.25 7.25h.01M8.25 7.25h5M5.25 10.75h.01M8.25 10.75h5M2.75 13.75h.01M5.75 13.75h7.5" />
    </Glyph>
  )
}

/** The pages under this one: a page, with two hanging from it. */
export function ChildPagesIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <rect x="2.25" y="1.75" width="5.5" height="4.5" rx="1" />
      <path d="M4.25 6.25v6.5h3.5M4.25 9h3.5" />
      <rect x="8.25" y="7.5" width="5.5" height="3" rx="0.75" />
      <rect x="8.25" y="11.25" width="5.5" height="3" rx="0.75" />
    </Glyph>
  )
}
