import { revisionId } from '@quill/domain'
import type { DocumentId, RevisionId, WorkspaceId } from '@quill/domain'

import type {
  ContentDiff,
  ContentFile,
  ContentStore,
  DocumentSource,
  MergeConflict,
  Page,
  PublishRequest,
  PublishResult,
  PutFileRequest,
  PutFileResult,
  RevisionSummary,
  TreeEntry,
} from '../ports/content-store.ts'

/**
 * An in-memory `ContentStore` for unit tests of the use cases.
 *
 * It keeps a snapshot per revision rather than a Git object graph, which is
 * all a use case can observe through the port: documents, revisions, and
 * diffs. The rules that matter above the port are real — publish is the only
 * write, a publish against a stale base conflicts when the document moved
 * underneath it, and history is newest first — so a test of a use case is a
 * test of the use case and not of the store. `GitContentStore` itself is
 * exercised where it is composed, in the server's integration tests.
 */

interface StoredDocument {
  readonly path: string
  readonly markdown: string
}

interface StoredRevision {
  readonly revision: RevisionId
  readonly documents: ReadonlyMap<DocumentId, StoredDocument>
  /** Non-document files by path (ADR-034 settings). */
  readonly files: ReadonlyMap<string, string>
  readonly changed: readonly DocumentId[]
  readonly author: { readonly name: string; readonly email: string }
  readonly summary: string
  readonly changeNote: string | undefined
  readonly timestamp: Date
}

export interface FakeContentStore extends ContentStore {
  /** Every publish this store accepted, in order. */
  readonly requests: readonly PublishRequest[]
  /** Every file write this store accepted, in order. */
  readonly writtenFiles: readonly PutFileRequest[]
}

export interface FakeContentStoreOptions {
  readonly now?: () => Date
}

export function createFakeContentStore(options: FakeContentStoreOptions = {}): FakeContentStore {
  const now = options.now ?? ((): Date => new Date('2026-01-01T00:00:00.000Z'))
  const workspaces = new Map<WorkspaceId, StoredRevision[]>()
  const requests: PublishRequest[] = []
  const writtenFiles: PutFileRequest[] = []
  let counter = 0

  const revisionsOf = (workspaceId: WorkspaceId): StoredRevision[] => {
    const existing = workspaces.get(workspaceId)
    if (existing !== undefined) return existing
    const created: StoredRevision[] = []
    workspaces.set(workspaceId, created)
    return created
  }

  const at = (workspaceId: WorkspaceId, revision?: RevisionId): StoredRevision | null => {
    const revisions = revisionsOf(workspaceId)
    if (revision === undefined) return revisions.at(-1) ?? null
    return revisions.find((entry) => entry.revision === revision) ?? null
  }

  return {
    requests,
    writtenFiles,

    async head(workspaceId) {
      return at(workspaceId)?.revision ?? null
    },

    async read(workspaceId, documentId, revision) {
      const snapshot = at(workspaceId, revision)
      const found = snapshot?.documents.get(documentId)
      if (snapshot === null || found === undefined) return null
      return {
        documentId,
        path: found.path,
        markdown: found.markdown,
        revision: snapshot.revision,
      } satisfies DocumentSource
    },

    async publish(request) {
      const revisions = revisionsOf(request.workspaceId)
      const current = revisions.at(-1) ?? null
      const conflicts = conflictsWith(request, current)
      if (conflicts.length > 0 && current !== null) {
        return { kind: 'merge-required', current: current.revision, conflicts }
      }

      counter += 1
      const documents = new Map(current?.documents ?? [])
      const changed: DocumentId[] = []
      for (const change of request.changes) {
        changed.push(change.documentId)
        if (change.kind === 'delete') documents.delete(change.documentId)
        else if (change.kind === 'write') {
          documents.set(change.documentId, { path: change.path, markdown: change.markdown })
        } else {
          const carried = change.markdown ?? documents.get(change.documentId)?.markdown
          if (carried === undefined) documents.delete(change.documentId)
          else documents.set(change.documentId, { path: change.toPath, markdown: carried })
        }
      }

      const revision = revisionId(counter.toString(16).padStart(40, '0'))
      revisions.push({
        revision,
        documents,
        files: current?.files ?? new Map(),
        changed,
        author: request.author,
        summary: request.summary ?? 'Publish',
        changeNote: request.changeNote,
        timestamp: now(),
      })
      requests.push(request)
      return { kind: 'published', revision } satisfies PublishResult
    },

    async history(workspaceId, documentId, page: Page) {
      const revisions = revisionsOf(workspaceId).filter((entry) =>
        entry.changed.includes(documentId),
      )
      const newestFirst = revisions.toReversed()
      const start =
        page.cursor === undefined
          ? 0
          : newestFirst.findIndex((entry) => entry.revision === page.cursor) + 1
      return newestFirst.slice(start, start + page.limit).map((entry): RevisionSummary => ({
        revision: entry.revision,
        author: entry.author,
        timestamp: entry.timestamp,
        summary: entry.summary,
        documentIds: entry.changed,
        ...(entry.changeNote === undefined ? {} : { changeNote: entry.changeNote }),
      }))
    },

    async diff(workspaceId, documentId, from, to) {
      const before =
        from === null ? null : (at(workspaceId, from)?.documents.get(documentId) ?? null)
      const after = at(workspaceId, to)?.documents.get(documentId) ?? null
      const removed = lines(before?.markdown)
      const added = lines(after?.markdown)
      const unified = [
        `--- a/${before?.path ?? 'null'}`,
        `+++ b/${after?.path ?? 'null'}`,
        ...removed.map((line) => `-${line}`),
        ...added.map((line) => `+${line}`),
      ].join('\n')
      return {
        documentId,
        from,
        to,
        unified,
        added: added.length,
        removed: removed.length,
      } satisfies ContentDiff
    },

    async listTree(workspaceId, revision) {
      const snapshot = at(workspaceId, revision)
      if (snapshot === null) return []
      return [
        ...[...snapshot.documents].map(([documentId, document]): TreeEntry => ({
          path: document.path,
          kind: 'document',
          documentId,
        })),
        ...[...snapshot.files.keys()].map((path): TreeEntry => ({ path, kind: 'other' })),
      ]
    },

    async readFile(workspaceId, path, revision) {
      const snapshot = at(workspaceId, revision)
      const text = snapshot?.files.get(path)
      if (snapshot === null || text === undefined) return null
      return { path, text, revision: snapshot.revision } satisfies ContentFile
    },

    async putFile(request) {
      const revisions = revisionsOf(request.workspaceId)
      const current = revisions.at(-1) ?? null
      const existing = current?.files.get(request.path) ?? null
      if (existing !== request.expected) {
        return {
          kind: 'stale',
          current:
            existing === null || current === null
              ? null
              : { path: request.path, text: existing, revision: current.revision },
        }
      }

      counter += 1
      const files = new Map(current?.files ?? [])
      files.set(request.path, request.text)
      const revision = revisionId(counter.toString(16).padStart(40, '0'))
      revisions.push({
        revision,
        documents: current?.documents ?? new Map(),
        files,
        changed: [],
        author: request.author,
        summary: request.summary ?? `Update ${request.path}`,
        changeNote: request.changeNote,
        timestamp: now(),
      })
      writtenFiles.push(request)
      return { kind: 'published', revision } satisfies PutFileResult
    },
  }
}

/**
 * A publish based on a revision that is no longer the head conflicts only
 * where the document really moved underneath it: identical content merges
 * cleanly, which is the rule the real store's three-way merge follows.
 */
function conflictsWith(request: PublishRequest, current: StoredRevision | null): MergeConflict[] {
  if (current === null || request.base === null || request.base === current.revision) return []
  const base = request.base
  return request.changes.flatMap((change) => {
    if (change.kind !== 'write') return []
    const theirs = current.documents.get(change.documentId)
    if (theirs === undefined || theirs.markdown === change.markdown) return []
    return [
      {
        documentId: change.documentId,
        path: theirs.path,
        ours: change.markdown,
        theirs: theirs.markdown,
        base: `based on ${base}`,
        conflicted: `<<<<<<< ours\n${change.markdown}\n=======\n${theirs.markdown}\n>>>>>>> theirs`,
      } satisfies MergeConflict,
    ]
  })
}

function lines(markdown: string | undefined): readonly string[] {
  return markdown === undefined || markdown.length === 0 ? [] : markdown.split('\n')
}
