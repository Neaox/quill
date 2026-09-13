import type { WorkspaceId } from '@quill/domain'

import { loadConfig } from '../config.ts'
import { createContentStore } from '../infrastructure/content-store.ts'
import { createDatabase } from '../infrastructure/db/connection.ts'
import { runMigrations } from '../infrastructure/db/migrator.ts'
import { createHasher } from '../infrastructure/hasher.ts'
import { createDocumentFormat } from '../infrastructure/markdown/document-format.ts'
import { createUnitOfWork } from '../infrastructure/repositories/unit-of-work.ts'
import { createPostgresSearchIndex } from '../infrastructure/search/postgres-search-index.ts'
import { createVisibleDocumentResolver } from '../infrastructure/search/visible-documents.ts'
import { createSystemClock } from '../infrastructure/system-clock.ts'
import { createUuidGenerator } from '../infrastructure/uuid-generator.ts'
import { reindex } from './reindex.ts'

/**
 * `quill reindex` (ADR-034) — the composition root for rebuilding the search
 * index from the content store. The work itself is in `reindex.ts`, which is
 * where its tests point.
 *
 * ```
 * pnpm --filter @quill/server reindex                       # the whole instance
 * pnpm --filter @quill/server reindex -- --workspace <id>   # one workspace
 * pnpm --filter @quill/server reindex -- --render           # cached bodies too
 * ```
 *
 * Rebuilding an index is safe to run against a live instance and safe to run
 * twice: every write it makes is an upsert or a delete of something derived.
 */

function flag(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`)
  return at === -1 ? undefined : process.argv[at + 1]
}

const workspaceId = flag('workspace') as WorkspaceId | undefined
const render = process.argv.includes('--render')

const config = loadConfig()
const clock = createSystemClock()
const ids = createUuidGenerator()
const database = createDatabase({ connectionString: config.databaseUrl })
await runMigrations(database.pool)

const uow = createUnitOfWork(database.db, database.pool, ids)
const searchIndex = createPostgresSearchIndex({
  db: database.db,
  visibility: createVisibleDocumentResolver({ uow }),
  clock,
})

try {
  const result = await reindex(
    {
      uow,
      searchIndex,
      contentStore: createContentStore(config.contentStore, clock),
      format: createDocumentFormat(),
      clock,
      ids,
      hasher: createHasher(),
    },
    {
      workspaceId,
      render,
      onWorkspace: (progress) =>
        process.stdout.write(
          `  ${progress.name}: ${progress.indexed} indexed, ${progress.removed} removed\n`,
        ),
    },
  )

  process.stdout.write(
    [
      `Reindexed ${result.workspaces} workspace${result.workspaces === 1 ? '' : 's'}`,
      `  indexed:  ${result.indexed}`,
      `  removed:  ${result.removed} (no published revision)`,
      ...(render ? [`  rendered: ${result.rendered}`] : []),
      '',
    ].join('\n'),
  )
} finally {
  await database.close()
}
