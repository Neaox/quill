import { describe, expect, it } from 'vitest'

import { parseSqlSchema } from './parse-sql.ts'

const options = {
  dialect: 'postgres' as const,
  database: 'payments',
  source: 'migrations' as const,
  capturedAt: '2026-11-12T12:00:00.000Z',
  file: 'packages/persistence/src/migrations/0001-foundation.sql',
}

describe('SQL schema parser', () => {
  it('reads a table, its columns, keys and a foreign key', () => {
    const snapshot = parseSqlSchema(
      `
      CREATE TABLE IF NOT EXISTS payments.intents (
        id uuid PRIMARY KEY,
        customer_id uuid NOT NULL REFERENCES customers (id),
        status text NOT NULL DEFAULT 'created',
        amount numeric(12, 2) NOT NULL,
        note text,
        CONSTRAINT intents_status_check CHECK (status IN ('created', 'captured')),
        UNIQUE (customer_id, status)
      );
      `,
      options,
    )

    expect(snapshot.tables).toHaveLength(1)
    const table = snapshot.tables[0]
    expect(table).toMatchObject({ schema: 'payments', name: 'intents', kind: 'table' })
    expect(table?.primaryKey).toEqual(['id'])
    expect(table?.unique).toEqual([['customer_id', 'status']])
    expect(table?.foreignKeys).toEqual([
      { columns: ['customer_id'], references: { table: 'customers', columns: ['id'] } },
    ])
    expect(table?.columns.map((column) => column.name)).toEqual([
      'id',
      'customer_id',
      'status',
      'amount',
      'note',
    ])
    expect(table?.columns[2]).toMatchObject({
      name: 'status',
      type: 'text',
      nullable: false,
      default: "'created'",
    })
    expect(table?.columns[3]?.type).toBe('numeric(12, 2)')
    expect(table?.columns[4]?.nullable).toBe(true)
    expect(table?.source).toEqual({
      file: 'packages/persistence/src/migrations/0001-foundation.sql',
      line: 2,
    })
  })

  it('reads table-level keys and quoted identifiers', () => {
    const snapshot = parseSqlSchema(
      `CREATE TABLE "accounts"."people" (
        "id" uuid NOT NULL,
        "email" text NOT NULL,
        CONSTRAINT "people_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "people_email_key" UNIQUE ("email")
      );`,
      options,
    )

    expect(snapshot.tables[0]).toMatchObject({
      schema: 'accounts',
      name: 'people',
      primaryKey: ['id'],
      unique: [['email']],
    })
  })

  it('ignores comments and non-table statements', () => {
    const snapshot = parseSqlSchema(
      `
      -- a comment
      /* another comment */
      CREATE EXTENSION IF NOT EXISTS btree_gist;
      CREATE INDEX intents_customer ON payments.intents (customer_id);
      CREATE TABLE notes (id uuid PRIMARY KEY);
      `,
      options,
    )

    expect(snapshot.tables.map((table) => table.name)).toEqual(['notes'])
  })

  it('sorts tables by schema, name and kind', () => {
    const snapshot = parseSqlSchema(
      `
      CREATE TABLE zebra (id uuid);
      CREATE TABLE alpha (id uuid);
      CREATE TABLE public.zebra (id uuid);
      `,
      options,
    )

    expect(snapshot.tables.map((table) => table.name)).toEqual(['alpha', 'zebra', 'zebra'])
  })

  it('keeps a view as a table entry without columns', () => {
    const snapshot = parseSqlSchema('CREATE VIEW payments.open_intents AS SELECT 1;', options)

    expect(snapshot.tables[0]).toMatchObject({
      schema: 'payments',
      name: 'open_intents',
      kind: 'view',
      columns: [],
    })
  })
})
