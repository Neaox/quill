import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type pg from 'pg'

const here = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_MIGRATIONS_DIR = path.resolve(here, '../../../drizzle')

/** Arbitrary constant, unique to this application's migration runner (plan section 25). */
const ADVISORY_LOCK_KEY = 84_205_001

interface JournalEntry {
  readonly tag: string
}

interface Journal {
  readonly entries: readonly JournalEntry[]
}

export interface MigrationResult {
  readonly applied: readonly string[]
}

/**
 * Applies every migration in `migrationsDir` not yet recorded in
 * `schema_migrations`, guarded by a Postgres advisory lock so concurrent
 * server instances never race to migrate at startup (plan §25).
 *
 * Drizzle Kit always qualifies generated foreign keys with the `public`
 * schema regardless of where the referencing table itself is created. That
 * qualifier is stripped before the SQL runs, so a migration file works
 * whichever schema is first on the connection's `search_path` — the
 * mechanism `createDatabase` and `createTestDatabase` use to isolate
 * integration test runs from each other and from a real deployment.
 */
export async function runMigrations(
  pool: pg.Pool,
  migrationsDir: string = DEFAULT_MIGRATIONS_DIR,
): Promise<MigrationResult> {
  const client = await pool.connect()
  try {
    await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY])
    try {
      return await applyPendingMigrations(client, migrationsDir)
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY])
    }
  } finally {
    client.release()
  }
}

async function applyPendingMigrations(
  client: pg.PoolClient,
  migrationsDir: string,
): Promise<MigrationResult> {
  await client.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations (tag text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
  )

  const journal = JSON.parse(
    readFileSync(path.join(migrationsDir, 'meta', '_journal.json'), 'utf8'),
  ) as Journal
  const alreadyApplied = await client.query<{ tag: string }>('SELECT tag FROM schema_migrations')
  const appliedTags = new Set(alreadyApplied.rows.map((row) => row.tag))

  const applied: string[] = []
  for (const entry of journal.entries) {
    if (appliedTags.has(entry.tag)) {
      continue
    }
    await applyMigrationFile(client, migrationsDir, entry.tag)
    applied.push(entry.tag)
  }
  return { applied }
}

async function applyMigrationFile(
  client: pg.PoolClient,
  migrationsDir: string,
  tag: string,
): Promise<void> {
  const sql = readFileSync(path.join(migrationsDir, `${tag}.sql`), 'utf8').replaceAll(
    '"public".',
    '',
  )
  const statements = sql
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0)

  await client.query('BEGIN')
  try {
    for (const statement of statements) {
      await client.query(statement)
    }
    await client.query('INSERT INTO schema_migrations (tag) VALUES ($1)', [tag])
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}
