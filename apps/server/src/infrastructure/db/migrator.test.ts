import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createTestDatabase, type TestDatabase } from './test-database.ts'
import { runMigrations } from './migrator.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
// Outside `src/`, so a broad `--coverage.include` glob over `apps/server/src/**` never sweeps up
// this non-TypeScript fixture (a `.sql` file fails coverage's source-map remapping step).
const BROKEN_MIGRATIONS_DIR = path.resolve(here, '../../../test-fixtures/broken-migration')
const CONNECTION_STRING =
  process.env['DATABASE_URL'] ?? 'postgres://quill:quill@localhost:5432/quill'

let database: TestDatabase

beforeAll(async () => {
  database = await createTestDatabase()
}, 30_000)

afterAll(async () => {
  await database.drop()
})

describe('runMigrations', () => {
  it('applies nothing on a second run against an already-migrated schema', async () => {
    const result = await runMigrations(database.pool)
    expect(result.applied).toEqual([])
  })

  it('rolls back a failing migration file, leaving nothing committed', async () => {
    const schemaName = `test_rollback_${Date.now()}`
    const adminPool = new Pool({ connectionString: CONNECTION_STRING, max: 1 })
    await adminPool.query(`CREATE SCHEMA "${schemaName}"`)

    const pool = new Pool({
      connectionString: CONNECTION_STRING,
      options: `-c search_path=${schemaName},public`,
      max: 1,
    })
    try {
      await expect(runMigrations(pool, BROKEN_MIGRATIONS_DIR)).rejects.toThrow('syntax error')

      const tables = await pool.query(
        "SELECT tablename FROM pg_tables WHERE schemaname = $1 AND tablename = 'migrator_rollback_probe'",
        [schemaName],
      )
      expect(tables.rowCount).toBe(0)

      const migrations = await pool.query('SELECT tag FROM schema_migrations')
      expect(migrations.rowCount).toBe(0)
    } finally {
      await pool.end()
      await adminPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
      await adminPool.end()
    }
    // Migrating takes the one advisory lock every other integration test's
    // schema is also queueing for (see `migrator.ts`), so this waits behind
    // the whole suite rather than behind its own work: the allowance is the
    // same thirty seconds the database fixtures above take.
  }, 30_000)
})
