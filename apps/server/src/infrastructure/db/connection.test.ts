import { describe, expect, it } from 'vitest'

import { createDatabase } from './connection.ts'

const CONNECTION_STRING =
  process.env['DATABASE_URL'] ?? 'postgres://quill:quill@localhost:5432/quill'

describe('createDatabase', () => {
  it('connects without a schema override (the production path)', async () => {
    const database = createDatabase({ connectionString: CONNECTION_STRING })
    const result = await database.pool.query('SELECT current_schema()')
    expect(result.rows[0]).toEqual({ current_schema: 'public' })
    await database.close()
  })

  it('sets search_path when a schema is given', async () => {
    const database = createDatabase({
      connectionString: CONNECTION_STRING,
      schema: 'pg_catalog',
      max: 1,
    })
    const result = await database.pool.query('SHOW search_path')
    expect((result.rows[0] as { search_path: string }).search_path).toBe('pg_catalog,public')
    await database.close()
  })

  it('defaults the pool size', async () => {
    const database = createDatabase({ connectionString: CONNECTION_STRING })
    expect(database.pool.options.max).toBe(10)
    await database.close()
  })
})
