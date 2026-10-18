import { Glyph } from './icons.tsx'
import type { IconProps } from './icons.tsx'

/**
 * The icons for a link to a file (ADR-042, "File links"): one page-with-a-corner
 * outline, and inside it a mark for what kind of file it is.
 *
 * The geometry is data (`FILE_ICON_PATHS`) because it is drawn twice: here, for the
 * application and the editor, and in the reading stylesheet, where a server-built
 * card is plain HTML with an empty `<span data-file-kind>` and the icon is a CSS
 * mask (`packages/design-css/src/prose.css`). A test pins the two to the same
 * paths, so a change to one cannot leave the other behind.
 *
 * Always decorative: the card names the file and says its type in words, so an
 * icon is never the only thing that tells a reader what they are about to open.
 */

export const FILE_ICON_KINDS = [
  'image',
  'pdf',
  'video',
  'audio',
  'document',
  'spreadsheet',
  'presentation',
  'text',
  'archive',
] as const

export type FileIconKind = (typeof FILE_ICON_KINDS)[number]

/** The page and its folded corner, shared by every kind. */
export const FILE_ICON_PAGE = 'M4 2.75h5l3 3v7.5H4ZM9 2.75v3h3'

/** What marks each kind, inside the page. */
export const FILE_ICON_MARKS: Readonly<Record<FileIconKind, string>> = {
  image: 'm5.75 12 1.9-2.4 1.4 1.5.9-1 1.1 1.9',
  pdf: 'M5.75 11.75c1.1-1.5 1.7-3 2.25-3s.1 1.6 2.25 2.5',
  video: 'M7 8.75v3l2.75-1.5Z',
  audio: 'M7.25 12V8.75l3-.75v3M7.25 12h.01M10.25 11h.01',
  document: 'M6 8.5h4M6 10.5h4M6 12.25h2',
  spreadsheet: 'M6 8.75h4M6 10.75h4M8 8v4.25',
  presentation: 'M6 8.25h4v2.75H6ZM8 11v1.25',
  text: 'M6 9h4M6 11h2.5',
  archive: 'M8 3.5v1M8 5.5v1M8 7.5v1M7 9.5h2v2.5H7Z',
}

/** Every path a kind is drawn with, in the order it is drawn. */
export function fileIconPaths(kind: FileIconKind): readonly string[] {
  return [FILE_ICON_PAGE, FILE_ICON_MARKS[kind]]
}

export interface FileIconProps extends IconProps {
  readonly kind: FileIconKind
}

/** The icon for a kind of file. */
export function FileIcon({ kind, className }: FileIconProps) {
  return (
    <Glyph className={className}>
      {fileIconPaths(kind).map((path) => (
        <path key={path} d={path} />
      ))}
    </Glyph>
  )
}
