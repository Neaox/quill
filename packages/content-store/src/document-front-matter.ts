/**
 * The few front-matter fields the content store itself needs.
 *
 * A document's identity is the UUID in its front matter, not its path
 * (ADR-015), so reading a revision means finding the file whose `id` matches.
 * That is a scan of the first lines of a document, not a parse: the Markdown
 * package owns the schema and is deliberately not a dependency here, because
 * the store must be able to read a document it cannot fully understand.
 */

import { documentId, isUuid, type DocumentId } from '@quill/domain'

const FENCE = '---'
/** Front matter lives at the top of the file; never scan more than this. */
const SCAN_BYTES = 4096

/**
 * The lines between the fences, and nothing when there is no closing fence
 * within the scan window. Failing closed matters: a document whose front
 * matter is unterminated — or longer than the window — is one this package
 * does not understand, and reading a stray `id:` line out of its *body* would
 * give a second document the identity of the first.
 */
function frontMatterLines(markdown: string): readonly string[] {
  const head = markdown.slice(0, SCAN_BYTES)
  if (!head.startsWith(`${FENCE}\n`) && !head.startsWith(`${FENCE}\r\n`)) return []
  const lines = head.split(/\r?\n/).slice(1)
  const closing = lines.indexOf(FENCE)
  return closing === -1 ? [] : lines.slice(0, closing)
}

function unquote(value: string): string {
  const quoted = /^(['"])(.*)\1$/.exec(value)
  return quoted === null ? value : value.slice(1, -1)
}

/** A top-level scalar field of the front matter, or null when it is absent. */
export function frontMatterField(markdown: string, key: string): string | null {
  for (const line of frontMatterLines(markdown)) {
    if (line.startsWith(`${key}:`)) return unquote(line.slice(key.length + 1).trim())
  }
  return null
}

export function readDocumentId(markdown: string): DocumentId | null {
  const value = frontMatterField(markdown, 'id')
  return value !== null && isUuid(value) ? documentId(value) : null
}

export function readTitle(markdown: string): string | null {
  return frontMatterField(markdown, 'title')
}
