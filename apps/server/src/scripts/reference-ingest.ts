import { decodeCodeIndexArtifact } from '@quill/code-index'
import { ingestReference } from '@quill/application'
import type {
  IngestReferenceResult,
  ReferenceDependencies,
  ReferenceKind,
} from '@quill/application'
import type { WorkspaceId } from '@quill/domain'

/**
 * `quill reference:ingest` — put one artifact into a workspace's reference
 * index (ADR-065).
 *
 * The producer validates and writes the artifact; this command is the one
 * place the two formats meet the database. It reads the artifact's own capture
 * time, version and counts rather than taking them on trust from the command
 * line, so a stale or wrong file fails before anything is stored.
 */

export interface IngestReferenceFileCommand {
  readonly workspaceId: WorkspaceId
  readonly kind: ReferenceKind
  /** The commit the producer read. A schema capture names the same commit. */
  readonly sourceCommit: string
  /** The artifact's bytes, already read from the file. */
  readonly artifact: Uint8Array
  /** Overrides the artifact's own capture time; a test or a replayed import sets it. */
  readonly capturedAt?: Date | undefined
}

export interface ReferenceSummary {
  readonly artifactVersion: number
  readonly capturedAt: Date
  readonly symbolCount: number
  readonly tableCount: number
}

/** What the artifact says about itself, after the checks its reader makes. */
export function summariseReference(kind: ReferenceKind, artifact: Uint8Array): ReferenceSummary {
  const text = new TextDecoder().decode(artifact)
  return kind === 'code' ? summariseCode(text) : summariseSchema(text)
}

function summariseCode(text: string): ReferenceSummary {
  const decoded = decodeCodeIndexArtifact(text)
  if (!decoded.ok) {
    throw new Error(
      `The code artifact is not readable: ${decoded.error.code}: ${decoded.error.detail}`,
    )
  }
  const artifact = decoded.value
  const symbolCount = Object.values(artifact.files).reduce(
    (total, file) => total + file.symbols.length,
    0,
  )
  return {
    artifactVersion: artifact.formatVersion,
    capturedAt: captureTime(artifact.generatedAt),
    symbolCount,
    tableCount: 0,
  }
}

function summariseSchema(text: string): ReferenceSummary {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    throw new Error(`The schema artifact is not JSON: ${String(error)}`, { cause: error })
  }
  if (!isRecord(value)) {
    throw new Error('The schema artifact is not an object')
  }
  const record = value
  if (record['formatVersion'] !== 1) {
    throw new Error(`This reader supports schema format 1, not ${String(record['formatVersion'])}`)
  }
  if (typeof record['capturedAt'] !== 'string' || !Array.isArray(record['tables'])) {
    throw new Error('The schema artifact needs a capture time and a table list')
  }
  if (!record['tables'].every((table) => typeof table === 'object' && table !== null)) {
    throw new Error('The schema artifact has a table that is not an object')
  }
  return {
    artifactVersion: 1,
    capturedAt: captureTime(record['capturedAt']),
    symbolCount: 0,
    tableCount: record['tables'].length,
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function captureTime(value: string): Date {
  const at = new Date(value)
  if (Number.isNaN(at.getTime())) throw new Error(`The artifact's capture time is not a date`)
  return at
}

/**
 * Reads one artifact and stores it with the provenance the artifact carries.
 *
 * The bytes are re-streamed to the blob store rather than held as a second
 * copy: a code artifact is tens of megabytes, and a `Uint8Array` is already
 * the whole of it.
 */
export async function ingestReferenceFile(
  deps: ReferenceDependencies,
  command: IngestReferenceFileCommand,
): Promise<IngestReferenceResult> {
  const summary = summariseReference(command.kind, command.artifact)
  return ingestReference(deps, {
    workspaceId: command.workspaceId,
    kind: command.kind,
    sourceCommit: command.sourceCommit,
    capturedAt: command.capturedAt ?? summary.capturedAt,
    artifactVersion: summary.artifactVersion,
    symbolCount: summary.symbolCount,
    tableCount: summary.tableCount,
    artifact: (async function* one() {
      yield command.artifact
    })(),
  })
}
