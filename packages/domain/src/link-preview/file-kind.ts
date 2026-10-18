/**
 * What kind of file a link to a file is (ADR-042, "File links"): the one place that
 * knows which media types are worth a card and what to call each, so the fetcher
 * (which types to answer from headers), the renderer (which icon) and the editor
 * (which icon) cannot disagree.
 *
 * Deliberately a short allowlist. An executable, an installer or an unknown
 * download (`application/octet-stream`) is never offered as a file card: a card
 * is a promise that this is something a reader would expect to open.
 */

export const FILE_KINDS = [
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

export type FileKind = (typeof FILE_KINDS)[number]

/** Exact media types, by kind. `image/*`, `video/*` and `audio/*` are matched by their family. */
const EXACT: Readonly<Record<string, FileKind>> = {
  'application/pdf': 'pdf',
  'application/msword': 'document',
  'application/rtf': 'document',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'document',
  'application/vnd.oasis.opendocument.text': 'document',
  'application/vnd.ms-excel': 'spreadsheet',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'spreadsheet',
  'application/vnd.oasis.opendocument.spreadsheet': 'spreadsheet',
  'text/csv': 'spreadsheet',
  'application/vnd.ms-powerpoint': 'presentation',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'presentation',
  'application/vnd.oasis.opendocument.presentation': 'presentation',
  'text/plain': 'text',
  'text/markdown': 'text',
  'application/zip': 'archive',
  'application/gzip': 'archive',
  'application/x-tar': 'archive',
  'application/x-7z-compressed': 'archive',
}

const FAMILIES: Readonly<Record<string, FileKind>> = {
  'image/': 'image',
  'video/': 'video',
  'audio/': 'audio',
}

/** The kind of file a media type is, or null when it is not one a card is made for. */
export function fileKindOf(mediaType: string): FileKind | null {
  const type = mediaType.trim().toLowerCase()
  const exact = EXACT[type]
  if (exact !== undefined) return exact
  const family = Object.entries(FAMILIES).find(([prefix]) => type.startsWith(prefix))
  return family === undefined ? null : family[1]
}

/** The media-type patterns a fetch answers from headers alone (`image/*` matches the family). */
export const FILE_MEDIA_TYPE_PATTERNS: readonly string[] = [
  ...Object.keys(FAMILIES).map((prefix) => `${prefix}*`),
  ...Object.keys(EXACT),
]

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const

/** A size as people write it: `12 MB`, `1.5 KB`; null when the host did not say. */
export function formatFileSize(bytes: number | null): string | null {
  if (bytes === null) return null
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  const rounded = unit === 0 ? String(value) : String(Math.round(value * 10) / 10)
  return `${rounded} ${UNITS[unit]}`
}

/** Whole words for the kinds that have no better name than their kind. */
const KIND_LABEL: Readonly<Record<FileKind, string>> = {
  image: 'Image',
  pdf: 'PDF document',
  video: 'Video',
  audio: 'Audio',
  document: 'Document',
  spreadsheet: 'Spreadsheet',
  presentation: 'Presentation',
  text: 'Text file',
  archive: 'Archive',
}

/** Types that have a name people use. */
const NAMED: Readonly<Record<string, string>> = {
  'application/msword': 'Word document',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word document',
  'text/csv': 'CSV file',
  'text/markdown': 'Markdown file',
  'application/zip': 'ZIP archive',
}

/** `png` in `image/png`, but not `vnd.microsoft.icon`: a short plain subtype reads as a format. */
function formatOf(mediaType: string): string | null {
  const subtype = /^[^/]+\/([a-z0-9]{2,5})(?:\+xml)?$/u.exec(mediaType)?.[1]
  return subtype !== undefined && subtype !== 'mpeg' ? subtype.toUpperCase() : null
}

/** "PDF document", "PNG image", "Word document": what a reader would call it. Null when it is not a file. */
export function fileTypeLabel(mediaType: string): string | null {
  const type = mediaType.trim().toLowerCase()
  const kind = fileKindOf(type)
  if (kind === null) return null
  const named = NAMED[type]
  if (named !== undefined) return named
  if (kind === 'image' || kind === 'video' || kind === 'audio') {
    const format = formatOf(type)
    return format === null ? KIND_LABEL[kind] : `${format} ${kind}`
  }
  return KIND_LABEL[kind]
}

/** The line under a file's name: its type and, when the host said, its size. */
export function fileMeta(file: {
  readonly mediaType: string
  readonly bytes: number | null
}): string | null {
  const label = fileTypeLabel(file.mediaType)
  const size = formatFileSize(file.bytes)
  if (label === null) return size
  return size === null ? label : `${label} · ${size}`
}
