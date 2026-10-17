import { cleanText } from './plain-text.ts'

/**
 * The name of a file a link points at (ADR-042, "File links"): what the host
 * suggests in `Content-Disposition`, else the last segment of the address.
 *
 * It is a stranger's text, so it is cleaned like any other (`cleanText`) and cut
 * to a single file name: a path in it (`../../x`, `C:\x`) keeps only its last
 * part, because a name is shown and never used to write anywhere, and a card
 * that displayed a path would be displaying something it has no business
 * implying.
 */

export const FILE_NAME_LIMIT = 120

/** `filename*=UTF-8''%E6…`, which can carry any script; the charset is ignored: it is decoded as UTF-8. */
const EXTENDED = /filename\*\s*=\s*[^']*'[^']*'([^;]+)/iu
const QUOTED = /filename\s*=\s*"((?:[^"\\]|\\.)*)"/iu
const BARE = /filename\s*=\s*([^;"\s]+)/iu

function suggested(disposition: string | null): string | null {
  if (disposition === null) return null
  const extended = EXTENDED.exec(disposition)?.[1]
  if (extended !== undefined) {
    try {
      return decodeURIComponent(extended.trim())
    } catch {
      // Not valid percent-encoding: fall through to the plain forms.
    }
  }
  const quoted = QUOTED.exec(disposition)?.[1]
  // Only an escaped quote is unescaped: a backslash is otherwise a path separator, which
  // `onlyTheName` must still see.
  if (quoted !== undefined) return quoted.replaceAll(String.raw`\"`, '"')
  return BARE.exec(disposition)?.[1] ?? null
}

function lastSegmentOf(address: string): string | null {
  try {
    const segment = new URL(address).pathname.split('/').at(-1) ?? ''
    return segment === '' ? null : decodeURIComponent(segment)
  } catch {
    return null
  }
}

/** One file name, never a path. */
function onlyTheName(raw: string): string {
  return raw.split(/[/\\]/u).at(-1) ?? ''
}

export function fileNameOf(disposition: string | null, address: string): string | null {
  const raw = suggested(disposition) ?? lastSegmentOf(address)
  return raw === null ? null : cleanText(onlyTheName(raw), FILE_NAME_LIMIT)
}
