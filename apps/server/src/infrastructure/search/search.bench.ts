import { performance } from 'node:perf_hooks'
import { createSearchService, visibilityFilter } from '@quill/search'
import type { CollectionId, UserId, WorkspaceId } from '@quill/domain'
import { Pool } from 'pg'

import { createDatabase } from '../db/connection.ts'
import { readConnectionString } from '../db/test-database.ts'
import { runMigrations } from '../db/migrator.ts'
import { createUnitOfWork } from '../repositories/unit-of-work.ts'
import { createPostgresSearchIndex } from './postgres-search-index.ts'
import { createVisibleDocumentResolver } from './visible-documents.ts'
import { createSystemClock } from '../system-clock.ts'
import { createUuidGenerator } from '../uuid-generator.ts'

/**
 * The search-query budget, measured (quill-plan.md §31: under 300 ms at
 * 50,000 documents).
 *
 * ```
 * pnpm --filter @quill/server bench:search              # seed if needed, then measure
 * pnpm --filter @quill/server bench:search -- --reseed  # build the corpus again
 * pnpm --filter @quill/server bench:search -- --explain # print the query plan instead
 * ```
 *
 * It builds a fixed corpus once in a schema of its own — 50,000 documents
 * across 20 workspaces, two of which the searching member may read — and
 * leaves it there, so a before-and-after comparison measures the query and
 * not the seed, and so both halves of the comparison see identical data.
 *
 * The seed writes rows in bulk rather than publishing 50,000 documents
 * through the content store, because what is being measured is the read path.
 * Everything the read path consults — the documents, collections, workspaces
 * and grants the permission walk needs, and the generated `tsvector`
 * PostgreSQL computes for each row — is exactly what a real publish leaves
 * behind.
 */

const SCHEMA = 'bench_search'
const WORKSPACES = 20
const READABLE_WORKSPACES = 2
const DOCUMENTS_PER_WORKSPACE = 2_500
const PAGE = 20
const RUNS = 5

const MEMBER = '00000000-0000-4000-8000-00000000be01' as UserId
const NOW = new Date('2026-02-01T00:00:00.000Z')
const ids = createUuidGenerator()
const REVISION = 'a'.repeat(40)

const QUERIES = [
  'database failover runbook',
  'failover',
  '"campaign database"',
  'databse failover runbok',
  'tag:runbook',
]

const TOPICS = [
  'database failover runbook',
  'cache warm-up procedure',
  'deployment checklist',
  'incident response runbook',
  'campaign database schema',
  'onboarding guide',
  'observability dashboard',
  'release notes',
]

const FILLER =
  'The service degrades gracefully when a dependency is unavailable and recovers without operator action. ' +
  'Metrics are exported for every request and alerts fire on the ratio rather than the count. ' +
  'Runbooks are reviewed quarterly and the on-call rotation is published a month ahead. '

function topicFor(index: number): string {
  return TOPICS[index % TOPICS.length] ?? 'runbook'
}

function title(index: number): string {
  return `${topicFor(index)} ${index}`
}

function body(index: number): string {
  return `${topicFor(index)}. ${FILLER}${FILLER}Document number ${index} of the corpus. ${topicFor(index)} again.`
}

async function alreadySeeded(pool: Pool): Promise<boolean> {
  const { rows } = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'document_search'`,
    [SCHEMA],
  )
  if (rows[0]?.count === '0') return false
  const counted = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM "${SCHEMA}".document_search`,
  )
  return Number(counted.rows[0]?.count ?? '0') >= WORKSPACES * DOCUMENTS_PER_WORKSPACE
}

async function seed(): Promise<void> {
  const admin = new Pool({ connectionString: readConnectionString(), max: 1 })
  try {
    if (process.argv.includes('--reseed')) {
      await admin.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`)
    }
    await admin.query(`CREATE SCHEMA IF NOT EXISTS "${SCHEMA}"`)
  } finally {
    await admin.end()
  }

  const handle = createDatabase({
    connectionString: readConnectionString(),
    schema: SCHEMA,
    max: 4,
  })
  await runMigrations(handle.pool)

  if (await alreadySeeded(handle.pool)) {
    process.stdout.write(`corpus already in "${SCHEMA}"; reusing it (--reseed rebuilds)\n\n`)
    await handle.close()
    return
  }

  const started = performance.now()
  const uow = createUnitOfWork(handle.db, handle.pool, ids)
  const { repos } = uow

  await repos.users.create({ id: MEMBER, email: 'bench@example.com', displayName: 'B', now: NOW })
  const unit = await repos.units.create({
    id: ids.uuid(),
    parentId: null,
    name: 'Acme',
    slug: 'acme',
    label: 'company',
    now: NOW,
  })

  let written = 0
  for (let w = 0; w < WORKSPACES; w += 1) {
    const workspace = await repos.workspaces.create({
      id: ids.uuid() as WorkspaceId,
      unitId: unit.id,
      name: `Workspace ${w}`,
      slug: `workspace-${w}`,
      now: NOW,
    })
    const collection = await repos.collections.create({
      id: ids.uuid() as CollectionId,
      workspaceId: workspace.id as WorkspaceId,
      name: 'Runbooks',
      slug: 'runbooks',
      now: NOW,
    })

    if (w < READABLE_WORKSPACES) {
      await repos.grants.create({
        id: ids.uuid() as never,
        principalKind: 'user',
        principalId: MEMBER,
        scopeKind: 'workspace',
        scopeId: workspace.id,
        role: 'viewer',
        effect: 'allow',
        createdBy: null,
        now: NOW,
      })
    }

    const documentIds: string[] = []
    const shortIds: string[] = []
    const paths: string[] = []
    const titles: string[] = []
    const bodies: string[] = []
    const tags: string[] = []
    const updatedAt: Date[] = []

    for (let d = 0; d < DOCUMENTS_PER_WORKSPACE; d += 1) {
      written += 1
      documentIds.push(ids.uuid())
      shortIds.push(written.toString(36).padStart(10, '0'))
      paths.push(`runbooks/document-${written}.md`)
      titles.push(title(written))
      bodies.push(body(written))
      tags.push(written % 3 === 0 ? 'runbook' : 'guide')
      updatedAt.push(new Date(NOW.getTime() - written * 60_000))
    }

    await handle.pool.query(
      `INSERT INTO documents (id, short_id, workspace_id, collection_id, parent_id, slug, path, title, status, template_id, template_version, head_revision, created_at, updated_at)
       SELECT id, short_id, $3, $4, NULL, 'document', path, title, 'published', NULL, NULL, $5, $6, updated_at
       FROM unnest($1::text[], $2::text[], $7::text[], $8::text[], $9::timestamptz[]) AS t(id, short_id, path, title, updated_at)`,
      [documentIds, shortIds, workspace.id, collection.id, REVISION, NOW, paths, titles, updatedAt],
    )
    await handle.pool.query(
      `INSERT INTO document_search (document_id, workspace_id, collection_id, path, title, headings, body, tags, owners, status, updated_at, revision, index_version, indexed_at)
       SELECT id, $2, $3, path, title, 'Procedure Procedure Procedure Procedure Procedure', body, ARRAY[tag], ARRAY['ada lovelace'], 'published', updated_at, $4, 1, $5
       FROM unnest($1::text[], $6::text[], $7::text[], $8::text[], $9::text[], $10::timestamptz[]) AS t(id, path, title, body, tag, updated_at)`,
      [
        documentIds,
        workspace.id,
        collection.id,
        REVISION,
        NOW,
        paths,
        titles,
        bodies,
        tags,
        updatedAt,
      ],
    )
    process.stdout.write(`  seeded workspace ${w + 1}/${WORKSPACES}\n`)
  }

  await handle.pool.query(`ANALYZE "${SCHEMA}".document_search`)
  await handle.pool.query(`ANALYZE "${SCHEMA}".documents`)
  process.stdout.write(
    `seeded ${written} documents in ${Math.round(performance.now() - started)} ms\n\n`,
  )
  await handle.close()
}

function median(values: readonly number[]): number {
  const sorted = [...values].toSorted((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

async function measure(): Promise<void> {
  const handle = createDatabase({
    connectionString: readConnectionString(),
    schema: SCHEMA,
    max: 4,
  })
  const uow = createUnitOfWork(handle.db, handle.pool, ids)
  const index = createPostgresSearchIndex({
    db: handle.db,
    visibility: createVisibleDocumentResolver({ uow }),
    clock: createSystemClock(),
  })
  const service = createSearchService(index)

  const workspaces = await uow.repos.workspaces.listAll()
  const readable = workspaces
    .filter((workspace) => Number(workspace.slug.replace('workspace-', '')) < READABLE_WORKSPACES)
    .toSorted((a, b) => (a.slug < b.slug ? -1 : 1))
    .map((workspace) => workspace.id as WorkspaceId)
  const current = readable[0]
  if (current === undefined) throw new Error('the corpus has no readable workspace')

  const filter = visibilityFilter(readable, [{ kind: 'user', userId: MEMBER }, { kind: 'public' }])

  process.stdout.write(`| Query | Median of ${RUNS} | Hits |\n| --- | --- | --- |\n`)
  for (const queryText of QUERIES) {
    const timings: number[] = []
    let hits = 0
    for (let run = 0; run < RUNS + 1; run += 1) {
      const started = performance.now()
      const results = await service.search({
        queryText,
        filter,
        currentWorkspaceId: current,
        limit: PAGE,
      })
      const elapsed = performance.now() - started
      if (!results.ok) throw new Error(`query did not parse: ${results.error.message}`)
      // The first run is discarded: it pays for the connection and the plan.
      if (run > 0) timings.push(elapsed)
      hits =
        results.value.current.length +
        results.value.elsewhere.reduce((total, group) => total + group.hits.length, 0)
    }
    process.stdout.write(`| \`${queryText}\` | ${median(timings).toFixed(0)} ms | ${hits} |\n`)
  }

  await handle.close()
}

/**
 * The plan for the query the budget is about, so a change that was supposed to
 * make an index usable can be shown to have done it.
 */
async function explain(): Promise<void> {
  const handle = createDatabase({
    connectionString: readConnectionString(),
    schema: SCHEMA,
    max: 2,
  })
  const client = await handle.pool.connect()
  try {
    await client.query(`SET LOCAL pg_trgm.similarity_threshold = 0.3`)
    const workspaces = await client.query<{ id: string }>(
      `SELECT id FROM workspaces WHERE slug IN ('workspace-0', 'workspace-1')`,
    )
    const readable = workspaces.rows.map((row) => row.id)
    const { rows } = await client.query<{ 'QUERY PLAN': string }>(
      `EXPLAIN (ANALYZE, BUFFERS)
       SELECT document_id FROM document_search
       WHERE workspace_id = ANY($1::text[])
         AND search_vector @@ (plainto_tsquery('english', 'database') && plainto_tsquery('english', 'failover') && plainto_tsquery('english', 'runbook'))
       UNION
       SELECT document_id FROM document_search
       WHERE workspace_id = ANY($1::text[]) AND title % $2`,
      [readable, 'database failover runbook'],
    )
    process.stdout.write(`\n${rows.map((row) => row['QUERY PLAN']).join('\n')}\n`)
  } finally {
    client.release()
    await handle.close()
  }
}

await seed()
if (process.argv.includes('--explain')) await explain()
else await measure()
