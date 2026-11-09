import { createHash, randomUUID } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'

import { BRAND } from '@quill/brand'

import { createDatabase, type DatabaseHandle } from './connection.ts'
import { runMigrations } from './migrator.ts'

export interface TestDatabase extends DatabaseHandle {
  /** The suite's own database, created for it and dropped after it. */
  readonly name: string
  drop(): Promise<void>
}

/** Same default as `config.ts` — the one `docker compose up -d postgres` and `.env.example` agree on. */
const DEFAULT_CONNECTION_STRING = `postgres://${BRAND.slug}:${BRAND.slug}@localhost:5432/${BRAND.slug}`

const here = path.dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = path.resolve(here, '../../../drizzle')

/**
 * Held while one process builds the migrated template, so a run's suites
 * build it once between them. Its own key, apart from the migrator's.
 */
const TEMPLATE_LOCK_KEY = 84_205_002

/**
 * The connection string integration tests use: `DATABASE_URL` when it is set
 * and non-empty, else the local Compose default. The environment is a
 * parameter so every branch is exercised the same way on every platform.
 */
export function readConnectionString(env: NodeJS.ProcessEnv = process.env): string {
  const value = env['DATABASE_URL']
  return value === undefined || value.length === 0 ? DEFAULT_CONNECTION_STRING : value
}

/** The same server, another database on it. */
function onDatabase(connectionString: string, database: string): string {
  const url = new URL(connectionString)
  url.pathname = `/${database}`
  return url.href
}

/**
 * The migrated template's name: a hash of every migration and the journal,
 * so a run with different migrations builds its own and never clones one
 * migrated differently.
 */
export function templateName(migrationsDir: string = MIGRATIONS_DIR): string {
  const hash = createHash('sha256')
  const files = readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .toSorted()
  for (const file of files) hash.update(file).update(readFileSync(path.join(migrationsDir, file)))
  hash.update(readFileSync(path.join(migrationsDir, 'meta', '_journal.json')))
  return `${BRAND.slug}_template_${hash.digest('hex').slice(0, 16)}`
}

/** This process's template on each server, built or found once. */
const templates = new Map<string, Promise<string>>()

/**
 * A database migrated once per set of migrations, which every suite's
 * database is cloned from.
 *
 * Migrating a fresh schema for every suite cost half a second of SQL each,
 * and the migrator's advisory lock made the suites of a whole run take that
 * half second one after another: a suite's `beforeAll` waited behind every
 * other suite migrating, and on a loaded machine that queue passed its 30 s
 * budget. Building the template is the only migration a run does: one
 * process builds it under an advisory lock while the others wait for it, and
 * it is built under another name and renamed when complete, so a template
 * that exists is always whole.
 */
export async function prepareTemplate(
  connectionString: string,
  migrationsDir: string = MIGRATIONS_DIR,
  name: string = templateName(migrationsDir),
): Promise<string> {
  const admin = new Pool({ connectionString, max: 1 })
  try {
    const client = await admin.connect()
    try {
      await client.query('SELECT pg_advisory_lock($1)', [TEMPLATE_LOCK_KEY])
      try {
        const found = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name])
        if (found.rowCount === 0) await buildTemplate(connectionString, migrationsDir, name)
      } finally {
        await client.query('SELECT pg_advisory_unlock($1)', [TEMPLATE_LOCK_KEY])
      }
    } finally {
      client.release()
    }
  } catch (error) {
    throw new Error(
      `Could not reach Postgres at ${connectionString} to prepare a test database. Run ` +
        `"docker compose up -d postgres" from the repository root. Original error: ${String(error)}`,
      { cause: error },
    )
  } finally {
    await admin.end()
  }
  return name
}

/** Migrates a database of its own under another name, then names it the template. */
async function buildTemplate(
  connectionString: string,
  migrationsDir: string,
  name: string,
): Promise<void> {
  const building = `${name}_building`
  // Not the lock's connection: that pool holds one, and it is held.
  const run = new Pool({ connectionString, max: 1 })
  try {
    // A build a killed run left behind is never used: it is started again.
    await run.query(`DROP DATABASE IF EXISTS "${building}" WITH (FORCE)`)
    await run.query(`CREATE DATABASE "${building}"`)
    const pool = new Pool({ connectionString: onDatabase(connectionString, building), max: 1 })
    try {
      await runMigrations(pool, migrationsDir)
    } finally {
      await pool.end()
    }
    await run.query(`ALTER DATABASE "${building}" RENAME TO "${name}"`)
  } finally {
    await run.end()
  }
}

/**
 * A fresh, randomly named, migrated database of its own for one suite, and a
 * handle on it — so parallel suites, and parallel runs, never collide. It is
 * a clone of the run's migrated template, which costs a file copy rather than
 * a migration. If Postgres is unreachable this throws with a clear message;
 * tests must fail loudly rather than silently skip.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const connectionString = readConnectionString()
  const template = templates.get(connectionString) ?? prepareTemplate(connectionString)
  templates.set(connectionString, template)
  let source: string
  try {
    source = await template
  } catch (error) {
    // The next suite tries again rather than inheriting this one's failure.
    templates.delete(connectionString)
    throw error
  }
  const name = `test_${randomUUID().replaceAll('-', '')}`

  const admin = new Pool({ connectionString, max: 1 })
  try {
    await admin.query(`CREATE DATABASE "${name}" TEMPLATE "${source}"`)
  } finally {
    await admin.end()
  }

  const handle = createDatabase({ connectionString: onDatabase(connectionString, name), max: 5 })
  return {
    ...handle,
    name,
    async drop() {
      await handle.close()
      const dropping = new Pool({ connectionString, max: 1 })
      try {
        await dropping.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
      } finally {
        await dropping.end()
      }
    },
  }
}
