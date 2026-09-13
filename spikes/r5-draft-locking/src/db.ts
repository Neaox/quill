import pg from 'pg'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const { Pool } = pg

const here = path.dirname(fileURLToPath(import.meta.url))
const SCHEMA_SQL_PATH = path.join(here, '..', 'sql', 'schema.sql')

export const CONNECTION_STRING =
  process.env.SPIKE_R5_DATABASE_URL ?? 'postgres://quill:quill@localhost:5432/quill'

export function createPool(max = 20) {
  return new Pool({ connectionString: CONNECTION_STRING, max })
}

/** Creates schema spike_r5 and its tables. Safe to call repeatedly. */
export async function setupSchema(pool: pg.Pool): Promise<void> {
  const sql = readFileSync(SCHEMA_SQL_PATH, 'utf8')
  await pool.query(sql)
}

/** Drops schema spike_r5 and everything in it. */
export async function dropSchema(pool: pg.Pool): Promise<void> {
  await pool.query('DROP SCHEMA IF EXISTS spike_r5 CASCADE')
}

/** Empties both tables without dropping the schema — used between tests. */
export async function truncateAll(pool: pg.Pool): Promise<void> {
  await pool.query('TRUNCATE spike_r5.document_lock, spike_r5.draft')
}
