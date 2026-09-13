import { Pool } from 'pg'
import { afterEach, describe, expect, it } from 'vitest'

import { createTestDatabase } from './test-database.ts'

const originalDatabaseUrl = process.env['DATABASE_URL']

afterEach(() => {
  if (originalDatabaseUrl === undefined) {
    delete process.env['DATABASE_URL']
  } else {
    process.env['DATABASE_URL'] = originalDatabaseUrl
  }
})

describe('createTestDatabase', () => {
  it('creates a randomly named, migrated schema and drops it cleanly', async () => {
    const database = await createTestDatabase()
    expect(database.schemaName).toMatch(/^test_[0-9a-f]{32}$/)

    const tables = await database.pool.query<{ tablename: string }>(
      'SELECT tablename FROM pg_tables WHERE schemaname = $1',
      [database.schemaName],
    )
    expect(tables.rows.map((row) => row.tablename)).toEqual(
      expect.arrayContaining(['users', 'documents', 'document_locks', 'drafts', 'outbox_events']),
    )

    // The public principal is seeded by the migration so grant creation never races to create it.
    const principal = await database.pool.query("SELECT id FROM principals WHERE kind = 'public'")
    expect(principal.rowCount).toBe(1)

    await database.drop()

    const adminPool = new Pool({
      connectionString: originalDatabaseUrl ?? 'postgres://quill:quill@localhost:5432/quill',
    })
    const after = await adminPool.query('SELECT 1 FROM pg_namespace WHERE nspname = $1', [
      database.schemaName,
    ])
    expect(after.rowCount).toBe(0)
    await adminPool.end()
  }, 30_000)

  it('two schemas created concurrently never collide', async () => {
    const [a, b] = await Promise.all([createTestDatabase(), createTestDatabase()])
    expect(a.schemaName).not.toBe(b.schemaName)
    await Promise.all([a.drop(), b.drop()])
  }, 30_000)

  it('fails with a clear message when Postgres is unreachable, rather than skipping', async () => {
    process.env['DATABASE_URL'] = 'postgres://quill:quill@127.0.0.1:1/quill'
    await expect(createTestDatabase()).rejects.toThrow(/Could not reach Postgres/)
  }, 10_000)
})
