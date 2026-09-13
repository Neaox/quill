import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'

import { BRAND } from '@quill/brand'

import { createDatabase, type DatabaseHandle } from './connection.ts'
import { runMigrations } from './migrator.ts'

export interface TestDatabase extends DatabaseHandle {
  readonly schemaName: string
  drop(): Promise<void>
}

/** Same default as `config.ts` — the one `docker compose up -d postgres` and `.env.example` agree on. */
const DEFAULT_CONNECTION_STRING = `postgres://${BRAND.slug}:${BRAND.slug}@localhost:5432/${BRAND.slug}`

function readConnectionString(): string {
  const value = process.env['DATABASE_URL']
  return value === undefined || value.length === 0 ? DEFAULT_CONNECTION_STRING : value
}

/**
 * Creates a fresh, randomly named Postgres schema, migrates it, and returns
 * a handle bound to it via `search_path` — so parallel integration test runs
 * never collide. If Postgres is unreachable this throws with a clear
 * message; tests must fail loudly rather than silently skip.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const connectionString = readConnectionString()
  const schemaName = `test_${randomUUID().replaceAll('-', '')}`

  const adminPool = new Pool({ connectionString, max: 1 })
  try {
    await adminPool.query(`CREATE SCHEMA "${schemaName}"`)
  } catch (error) {
    throw new Error(
      `Could not reach Postgres at ${connectionString} to create a test schema. Run ` +
        `"docker compose up -d postgres" from the repository root. Original error: ${String(error)}`,
      { cause: error },
    )
  } finally {
    await adminPool.end()
  }

  const handle = createDatabase({ connectionString, schema: schemaName, max: 5 })
  await runMigrations(handle.pool)

  return {
    ...handle,
    schemaName,
    async drop() {
      await handle.close()
      const adminDropPool = new Pool({ connectionString, max: 1 })
      try {
        await adminDropPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
      } finally {
        await adminDropPool.end()
      }
    },
  }
}
