import { is } from 'drizzle-orm'
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'

import * as schema from './schema.ts'

/**
 * `.references(() => otherTable.column)` stores its callback lazily;
 * ordinary CRUD queries (what every repository does) never call it, so it
 * would otherwise never execute. `getTableConfig` resolves every foreign
 * key, which is exactly the shape check that catches a typo'd reference
 * (wrong table or column) before a migration ever runs.
 */
describe('schema', () => {
  // `is()` is a runtime check; the cast reflects what it just verified rather than asserting past a type error.
  const tables = Object.entries(schema).filter(([, value]) => is(value, PgTable)) as [
    string,
    PgTable,
  ][]

  it('declares at least one table', () => {
    expect(tables.length).toBeGreaterThan(0)
  })

  it.each(tables)(
    '%s has a name and its foreign keys resolve to a real column',
    (_exportName, table) => {
      const config = getTableConfig(table)
      expect(config.name.length).toBeGreaterThan(0)
      expect(config.columns.length).toBeGreaterThan(0)

      for (const foreignKey of config.foreignKeys) {
        const reference = foreignKey.reference()
        expect(reference.foreignTable).toBeDefined()
        expect(reference.foreignColumns.length).toBeGreaterThan(0)
        expect(reference.columns.length).toBe(reference.foreignColumns.length)
      }
    },
  )
})
