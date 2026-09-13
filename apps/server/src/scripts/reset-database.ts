import { Client } from 'pg'

export interface ResetDatabaseOptions {
  /** The database to reset, as a connection string whose path names it. */
  readonly connectionString: string
  /**
   * Resets a database whose name does not say it is disposable. Without it,
   * only `*_e2e` and `*_test` are touched, because this drops everything.
   */
  readonly allow?: boolean | undefined
}

export interface ResetDatabaseResult {
  readonly database: string
  /** Whether the database had to be created first. */
  readonly created: boolean
}

const DISPOSABLE_SUFFIXES = ['_e2e', '_test'] as const

/** `postgres://u:p@host/quill_e2e` → `quill_e2e`. */
export function databaseNameOf(connectionString: string): string {
  const name = decodeURIComponent(new URL(connectionString).pathname.slice(1))
  if (name.length === 0) throw new Error('The connection string names no database')
  return name
}

export function isDisposableDatabaseName(name: string): boolean {
  return DISPOSABLE_SUFFIXES.some((suffix) => name.endsWith(suffix))
}

/**
 * Puts a database back to empty: creates it if it is missing, then drops and
 * recreates its `public` schema so the next `runMigrations` starts from
 * nothing. Sessions something else may already hold on it survive — dropping
 * a schema only waits on connections with a query in flight.
 *
 * Creating the database needs a session on another one, because Postgres
 * cannot create a database from inside a connection to it. The maintenance
 * database `postgres` is used for that, with the same credentials.
 */
export async function resetDatabase(options: ResetDatabaseOptions): Promise<ResetDatabaseResult> {
  const database = databaseNameOf(options.connectionString)
  if (options.allow !== true && !isDisposableDatabaseName(database)) {
    throw new Error(
      `Refusing to reset "${database}": only a database named *_e2e or *_test is dropped ` +
        'without DATABASE_RESET_ALLOW=1, because this discards everything in it.',
    )
  }

  const created = await ensureDatabaseExists(options.connectionString, database)

  const client = new Client({ connectionString: options.connectionString })
  await client.connect()
  try {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE')
    await client.query('CREATE SCHEMA public')
  } finally {
    await client.end()
  }
  return { database, created }
}

async function ensureDatabaseExists(connectionString: string, database: string): Promise<boolean> {
  const maintenance = new URL(connectionString)
  maintenance.pathname = '/postgres'
  const client = new Client({ connectionString: maintenance.href })
  await client.connect()
  try {
    const existing = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [database])
    if (existing.rowCount === 1) return false
    // An identifier cannot be bound as a parameter. The name came from the
    // connection string this process was configured with, and is quoted.
    await client.query(`CREATE DATABASE ${quoteIdentifier(database)}`)
    return true
  } finally {
    await client.end()
  }
}

function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`
}
