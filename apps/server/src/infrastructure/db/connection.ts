import { Pool } from 'pg'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'

import * as schema from './schema.ts'

export type Database = NodePgDatabase<typeof schema>

export interface DatabaseHandle {
  readonly pool: Pool
  readonly db: Database
  close(): Promise<void>
}

export interface CreateDatabaseOptions {
  readonly connectionString: string
  readonly max?: number
  /** Sets `search_path` for every connection in the pool; used to isolate integration test runs (one Postgres schema per run). */
  readonly schema?: string
}

/**
 * Creates the `pg` pool and the Drizzle handle over it. Kept as a single
 * factory so production and tests share one code path; tests pass a random
 * `schema` so parallel runs never collide (see `test-database.ts`).
 */
export function createDatabase(options: CreateDatabaseOptions): DatabaseHandle {
  const pool = new Pool({
    connectionString: options.connectionString,
    max: options.max ?? 10,
    ...(options.schema === undefined ? {} : { options: `-c search_path=${options.schema},public` }),
  })
  const db = drizzle(pool, { schema })

  return {
    pool,
    db,
    async close() {
      await pool.end()
    },
  }
}
