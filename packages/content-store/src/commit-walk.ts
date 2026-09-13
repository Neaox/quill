/**
 * Walking commits, and turning one into a {@link RevisionSummary}.
 *
 * The walk is lazy and first-parent: the content store has one branch and no
 * merges, so first-parent order is the revision order. It is also linear in the
 * number of commits, which is exactly why `history` takes a mandatory limit and
 * why the Postgres revisions index sits in front of it (ADR-014).
 */

import type { RevisionSummary } from '@quill/application'
import { documentId, isUuid, revisionId, type DocumentId } from '@quill/domain'
import { CHANGE_NOTE_TRAILER, DOCUMENT_ID_TRAILER } from './branding.ts'
import type { GitCommit } from './git/commit.ts'
import type { GitRepository } from './git/git-repository.ts'
import { parseTrailers, trailerValues, type Trailer } from './git/trailers.ts'

export interface WalkedCommit {
  readonly revision: string
  readonly commit: GitCommit
  readonly trailers: readonly Trailer[]
  /** The first parent, or null at the root of the history. */
  readonly parent: string | null
}

export async function* walkCommits(
  repository: GitRepository,
  start: string | null,
): AsyncGenerator<WalkedCommit> {
  let revision = start
  while (revision !== null) {
    const commit = await repository.readCommit(revision)
    const parent = commit.parents.at(0) ?? null
    yield { revision, commit, trailers: parseTrailers(commit.message), parent }
    revision = parent
  }
}

/** The document ids a commit says it changed. Unparseable values are ignored. */
export function changedDocumentIds(trailers: readonly Trailer[]): DocumentId[] {
  return trailerValues(trailers, DOCUMENT_ID_TRAILER)
    .filter((value) => isUuid(value))
    .map((value) => documentId(value))
}

export function toRevisionSummary(walked: WalkedCommit): RevisionSummary {
  const { commit, trailers } = walked
  const changeNote = trailerValues(trailers, CHANGE_NOTE_TRAILER).at(0)
  return {
    revision: revisionId(walked.revision),
    author: { name: commit.author.name, email: commit.author.email },
    timestamp: new Date(commit.author.when * 1000),
    summary: commit.message.slice(0, indexOfLineBreak(commit.message)),
    ...(changeNote === undefined ? {} : { changeNote }),
    documentIds: changedDocumentIds(trailers),
  }
}

function indexOfLineBreak(message: string): number {
  const index = message.indexOf('\n')
  return index === -1 ? message.length : index
}
