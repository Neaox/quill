import { randomUUID } from 'node:crypto'

import { Client } from 'pg'
import { afterAll, describe, expect, it } from 'vitest'

import { readConnectionString } from '../infrastructure/db/test-database.ts'
import { databaseNameOf, isDisposableDatabaseName, resetDatabase } from './reset-database.ts'

/** A database of this test's own, dropped afterwards, so `public` in the shared one is never touched. */
const NAME = `reset_${randomUUID().replaceAll('-', '').slice(0, 12)}_test`

function connectionStringFor(database: string): string {
  const url = new URL(readConnectionString())
  url.pathname = `/${database}`
  return url.href
}

async function withClient<T>(database: string, work: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: connectionStringFor(database) })
  await client.connect()
  try {
    return await work(client)
  } finally {
    await client.end()
  }
}

describe('resetDatabase', () => {
  afterAll(async () => {
    await withClient('postgres', (client) => client.query(`DROP DATABASE IF EXISTS "${NAME}"`))
  })

  it('creates a missing disposable database, then empties an existing one', async () => {
    const connectionString = connectionStringFor(NAME)

    await expect(resetDatabase({ connectionString })).resolves.toEqual({
      database: NAME,
      created: true,
    })
    await withClient(NAME, (client) => client.query('CREATE TABLE leftover (id int)'))

    await expect(resetDatabase({ connectionString })).resolves.toEqual({
      database: NAME,
      created: false,
    })
    const tables = await withClient(NAME, (client) =>
      client.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'"),
    )
    expect(tables.rows).toEqual([])
  })

  it('refuses a database whose name does not say it is disposable, unless allowed', async () => {
    await expect(
      resetDatabase({ connectionString: connectionStringFor('quill_keep_me') }),
    ).rejects.toThrow(/Refusing to reset "quill_keep_me"/)
  })

  it('reads the database name from the connection string', () => {
    expect(databaseNameOf('postgres://u:p@localhost:5432/quill_e2e')).toBe('quill_e2e')
    expect(databaseNameOf('postgres://u:p@localhost:5432/with%20space')).toBe('with space')
    expect(() => databaseNameOf('postgres://u:p@localhost:5432/')).toThrow(/names no database/)
    expect(isDisposableDatabaseName('quill_e2e')).toBe(true)
    expect(isDisposableDatabaseName('quill_test')).toBe(true)
    expect(isDisposableDatabaseName('quill')).toBe(false)
  })
})
