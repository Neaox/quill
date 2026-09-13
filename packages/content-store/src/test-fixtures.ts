/**
 * Shared fixtures for this package's tests. Deliberately branch-free: it builds
 * values, it never decides anything.
 */

import type { ContentChange } from '@quill/application'
import { documentId, workspaceId, type DocumentId, type WorkspaceId } from '@quill/domain'

export const AUTHOR = { name: 'Ada Lovelace', email: 'ada@example.com' } as const

/** A fixed clock: when a test ran is not part of what it is testing. */
export const NOW = (): Date => new Date('2026-09-12T10:00:00Z')

/**
 * The real clock, for the tests that put a `Date` beside a file's own mtime —
 * a lock file's age is measured against the clock the store was given, so the
 * two have to be the same clock.
 */
export const SYSTEM_NOW = (): Date => new Date()

/** Deterministic jitter, so a publish's backoff is reproducible. */
export const JITTER = (): number => 0.5

export function newWorkspaceId(): WorkspaceId {
  return workspaceId(crypto.randomUUID())
}

export function newDocument(): DocumentId {
  return documentId(crypto.randomUUID())
}

/** A document with the front matter the store reads: an id and a title. */
export function markdown(id: DocumentId, title: string, body = 'Body.'): string {
  return `---\nid: ${id}\ntitle: ${title}\n---\n\n# ${title}\n\n${body}\n`
}

export function write(id: DocumentId, path: string, text: string): ContentChange {
  return { kind: 'write', documentId: id, path, markdown: text }
}
