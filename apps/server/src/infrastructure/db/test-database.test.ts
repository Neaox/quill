import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { Pool } from 'pg'
import { afterEach, describe, expect, it } from 'vitest'

import {
  createTestDatabase,
  prepareTemplate,
  readConnectionString,
  templateName,
} from './test-database.ts'

const originalDatabaseUrl = process.env['DATABASE_URL']

afterEach(() => {
  if (originalDatabaseUrl === undefined) {
    delete process.env['DATABASE_URL']
  } else {
    process.env['DATABASE_URL'] = originalDatabaseUrl
  }
})

const adminUrl = () => originalDatabaseUrl ?? 'postgres://quill:quill@localhost:5432/quill'

async function databaseExists(name: string): Promise<boolean> {
  const admin = new Pool({ connectionString: adminUrl() })
  try {
    const found = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name])
    return found.rowCount === 1
  } finally {
    await admin.end()
  }
}

describe('createTestDatabase', () => {
  it('creates a randomly named, migrated database of its own and drops it cleanly', async () => {
    const database = await createTestDatabase()
    expect(database.name).toMatch(/^test_[0-9a-f]{32}$/)

    const tables = await database.pool.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public'",
    )
    expect(tables.rows.map((row) => row.tablename)).toEqual(
      expect.arrayContaining(['users', 'documents', 'document_locks', 'drafts', 'outbox_events']),
    )
    const current = await database.pool.query<{ name: string }>('SELECT current_database() AS name')
    expect(current.rows[0]?.name).toBe(database.name)

    // The public principal is seeded by the migration so grant creation never races to create it.
    const principal = await database.pool.query("SELECT id FROM principals WHERE kind = 'public'")
    expect(principal.rowCount).toBe(1)

    await database.drop()
    expect(await databaseExists(database.name)).toBe(false)
  }, 30_000)

  it('gives suites created at once databases of their own, each as migrated as the next', async () => {
    const databases = await Promise.all(Array.from({ length: 6 }, () => createTestDatabase()))
    expect(new Set(databases.map(({ name }) => name)).size).toBe(6)
    const migrated = await Promise.all(
      databases.map(
        async ({ pool }) => (await pool.query('SELECT tag FROM schema_migrations')).rowCount,
      ),
    )
    expect(new Set(migrated).size).toBe(1)
    await Promise.all(databases.map((database) => database.drop()))
  }, 30_000)

  it('fails with a clear message when Postgres is unreachable, rather than skipping', async () => {
    process.env['DATABASE_URL'] = 'postgres://quill:quill@127.0.0.1:1/quill'
    await expect(createTestDatabase()).rejects.toThrow(/Could not reach Postgres/)
    // Tried again, not remembered as failed.
    await expect(createTestDatabase()).rejects.toThrow(/Could not reach Postgres/)
  }, 10_000)
})

describe('prepareTemplate', () => {
  it('builds a template once under another name, starting over from a build left half done', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'quill-migrations-'))
    const name = `quill_template_test_${randomUUID().replaceAll('-', '').slice(0, 12)}`
    const admin = new Pool({ connectionString: adminUrl() })
    try {
      await mkdir(path.join(directory, 'meta'))
      await writeFile(
        path.join(directory, 'meta', '_journal.json'),
        JSON.stringify({ entries: [{ tag: '0000_only' }] }),
      )
      await writeFile(path.join(directory, '0000_only.sql'), 'CREATE TABLE only_table (id int);')
      // What a run killed part-way through leaves behind.
      await admin.query(`CREATE DATABASE "${name}_building"`)

      expect(await prepareTemplate(adminUrl(), directory, name)).toBe(name)
      expect(await databaseExists(`${name}_building`)).toBe(false)
      expect(await databaseExists(name)).toBe(true)
      // Found, not built again.
      expect(await prepareTemplate(adminUrl(), directory, name)).toBe(name)
    } finally {
      await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
      await admin.end()
      await rm(directory, { recursive: true, force: true })
    }
  }, 30_000)
})

describe('templateName', () => {
  it('names the template by the migrations, so different migrations never share one', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'quill-migrations-'))
    try {
      await mkdir(path.join(directory, 'meta'))
      await writeFile(path.join(directory, 'meta', '_journal.json'), '{"entries":[]}')
      await writeFile(path.join(directory, '0000_a.sql'), 'SELECT 1;')
      await writeFile(path.join(directory, 'notes.txt'), 'not a migration')
      const first = templateName(directory)
      expect(first).toMatch(/^quill_template_[0-9a-f]{16}$/)
      expect(templateName(directory)).toBe(first)
      await writeFile(path.join(directory, '0000_a.sql'), 'SELECT 2;')
      expect(templateName(directory)).not.toBe(first)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})

describe('readConnectionString', () => {
  it('uses DATABASE_URL when it is set', () => {
    expect(readConnectionString({ DATABASE_URL: 'postgres://u:p@db:5432/x' })).toBe(
      'postgres://u:p@db:5432/x',
    )
  })

  it('falls back to the Compose default when it is unset or empty', () => {
    expect(readConnectionString({})).toContain('@localhost:5432/')
    expect(readConnectionString({ DATABASE_URL: '' })).toContain('@localhost:5432/')
  })
})
