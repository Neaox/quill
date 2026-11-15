import { readFile } from 'node:fs/promises'

import { workspaceId } from '@quill/domain'

import { loadConfig } from '../config.ts'
import { createBlobStore } from '../infrastructure/blob/create-blob-store.ts'
import { createDatabase } from '../infrastructure/db/connection.ts'
import { runMigrations } from '../infrastructure/db/migrator.ts'
import { createUnitOfWork } from '../infrastructure/repositories/unit-of-work.ts'
import { createSystemClock } from '../infrastructure/system-clock.ts'
import { createUuidGenerator } from '../infrastructure/uuid-generator.ts'
import { ingestReferenceFile } from './reference-ingest.ts'

/**
 * `quill reference:ingest` — store one code or schema artifact for a
 * workspace's reference index (ADR-065). The work and its checks are in
 * `reference-ingest.ts`.
 *
 * ```
 * pnpm --filter @quill/server reference:ingest -- \
 *   --workspace <id> --kind code --commit <sha> --file reference.json
 * ```
 *
 * A schema capture takes the same command with `--kind schema`; its artifact
 * is the snapshot the live catalog reader produced.
 */

function flag(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`)
  return at === -1 ? undefined : process.argv[at + 1]
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

const workspace = flag('workspace')
if (workspace === undefined) fail('--workspace is required')
const kind = flag('kind')
if (kind !== 'code' && kind !== 'schema') fail('--kind is code or schema')
const commit = flag('commit')
if (commit === undefined || commit.trim() === '') fail('--commit is required')
const file = flag('file')
if (file === undefined) fail('--file is required')
const captured = flag('captured-at')
const capturedAt = captured === undefined ? undefined : new Date(captured)
if (capturedAt !== undefined && Number.isNaN(capturedAt.getTime())) {
  fail('--captured-at is not a date')
}

const artifact = await readFile(file)
const config = loadConfig()
const clock = createSystemClock()
const ids = createUuidGenerator()
const database = createDatabase({ connectionString: config.databaseUrl })
await runMigrations(database.pool)

try {
  const result = await ingestReferenceFile(
    {
      uow: createUnitOfWork(database.db, database.pool, ids),
      blobStore: createBlobStore(config.blobStore),
      clock,
      ids,
    },
    {
      workspaceId: workspaceId(workspace),
      kind,
      sourceCommit: commit,
      artifact,
      capturedAt,
    },
  )

  if (result.kind === 'workspace-not-found') {
    process.stderr.write(`No workspace ${workspace}\n`)
    process.exitCode = 1
  } else {
    process.stdout.write(
      [
        `Stored ${result.snapshot.kind} snapshot ${result.snapshot.id}`,
        `  artifact: ${result.snapshot.artifactHash} (${String(result.snapshot.artifactSize)} bytes)`,
        `  captured: ${result.snapshot.capturedAt.toISOString()} at ${result.snapshot.sourceCommit}`,
        ...(result.snapshot.kind === 'code'
          ? [`  symbols:  ${String(result.snapshot.symbolCount)}`]
          : [`  tables:   ${String(result.snapshot.tableCount)}`]),
        '',
      ].join('\n'),
    )
  }
} finally {
  await database.close()
}
