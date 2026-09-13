/**
 * Commit messages: a human subject line and the machine-readable trailers.
 *
 * The trailers are the recovery procedure. Every changed document's id is
 * recorded, so the revisions index can be rebuilt by reading commit objects
 * alone — no trees, no blobs (ADR-014).
 */

import type { ContentChange } from '@quill/application'
import { CHANGE_NOTE_TRAILER, DOCUMENT_ID_TRAILER } from './branding.ts'
import { readTitle } from './document-front-matter.ts'
import { foldTrailerValue, formatTrailer } from './git/trailers.ts'

export interface CommitMessage {
  readonly changes: readonly ContentChange[]
  readonly summary?: string
  readonly changeNote?: string
}

export function buildCommitMessage(message: CommitMessage): string {
  const subject = foldTrailerValue(message.summary ?? describe(message.changes))
  const ids = new Set(message.changes.map((change) => change.documentId))
  const trailers = [...ids].map((id) => formatTrailer(DOCUMENT_ID_TRAILER, id))
  if (message.changeNote !== undefined) {
    trailers.push(formatTrailer(CHANGE_NOTE_TRAILER, message.changeNote))
  }
  return `${subject}\n\n${trailers.join('\n')}\n`
}

/** A bulk publish is one revision, so it gets one subject line. */
function describe(changes: readonly ContentChange[]): string {
  const labels = changes.map(label)
  return labels.length === 1 ? labels.join('') : `Publish ${labels.length} documents`
}

function label(change: ContentChange): string {
  switch (change.kind) {
    case 'write':
      return `Update ${name(change.path, change.markdown)}`
    case 'move':
      return `Move ${name(change.toPath, change.markdown ?? '')}`
    case 'delete':
      return `Delete ${name(change.path, '')}`
  }
}

/** The document's own title when it has one, otherwise its file name. */
function name(path: string, markdown: string): string {
  return readTitle(markdown) ?? path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '')
}
