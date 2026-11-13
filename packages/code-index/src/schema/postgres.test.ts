import { describe, expect, it } from 'vitest'

import { assemblePostgresSchema, readPostgresSchema, type PostgresCatalogRows } from './postgres.ts'

const options = {
  database: 'payments',
  capturedAt: '2026-11-14T10:00:00.000Z',
  schemas: ['public', 'finance'],
} as const

const rows: PostgresCatalogRows = {
  namespaces: [
    { schema: 'public', comment: 'The tenant data.' },
    { schema: 'finance', comment: null },
  ],
  relations: [
    { schema: 'public', name: 'owners', kind: 'table', comment: 'One owner.' },
    { schema: 'public', name: 'account_view', kind: 'view', comment: 'One account.' },
    { schema: 'public', name: 'accounts', kind: 'table', comment: null },
  ],
  columns: [
    {
      schema: 'public',
      table: 'accounts',
      name: 'id',
      type: 'uuid',
      nullable: false,
      default: null,
      ordinal: 1,
      comment: null,
    },
    {
      schema: 'public',
      table: 'accounts',
      name: 'email',
      type: 'text',
      nullable: false,
      default: null,
      ordinal: 2,
      comment: 'The address a sign-in uses.',
    },
    {
      schema: 'public',
      table: 'accounts',
      name: 'owner_id',
      type: 'uuid',
      nullable: true,
      default: null,
      ordinal: 3,
      comment: null,
    },
    {
      schema: 'public',
      table: 'accounts',
      name: 'region',
      type: 'text',
      nullable: true,
      default: "'eu'::text",
      ordinal: 4,
      comment: null,
    },
    {
      schema: 'public',
      table: 'owners',
      name: 'id',
      type: 'uuid',
      nullable: false,
      default: null,
      ordinal: 1,
      comment: null,
    },
    {
      schema: 'public',
      table: 'account_view',
      name: 'id',
      type: 'uuid',
      nullable: true,
      default: null,
      ordinal: 1,
      comment: null,
    },
  ],
  keys: [
    { schema: 'public', table: 'accounts', primary: true, columns: ['id'] },
    { schema: 'public', table: 'accounts', primary: false, columns: ['email'] },
    { schema: 'public', table: 'accounts', primary: false, columns: ['owner_id', 'region'] },
    { schema: 'public', table: 'owners', primary: true, columns: ['id'] },
  ],
  foreignKeys: [
    {
      schema: 'public',
      table: 'accounts',
      columns: ['owner_id'],
      ref_schema: 'public',
      ref_table: 'owners',
      ref_columns: ['id'],
    },
  ],
  functions: [
    {
      schema: 'public',
      name: 'owner_name',
      signature: 'public.owner_name(uuid)',
      returns: 'text',
      language: 'sql',
      volatility: 'i',
      security_definer: false,
      comment: 'Returns the owner name for an id, or NULL.',
    },
    {
      schema: 'public',
      name: 'capture',
      signature: 'public.capture(uuid, text)',
      returns: 'void',
      language: 'plpgsql',
      volatility: 'v',
      security_definer: true,
      comment: null,
    },
  ],
}

describe('Postgres catalog schema reader', () => {
  it('assembles tables, columns, keys, references and comments', () => {
    const snapshot = assemblePostgresSchema(rows, options)

    expect(snapshot).toMatchObject({
      formatVersion: 1,
      dialect: 'postgres',
      database: 'payments',
      source: 'catalog',
      capturedAt: '2026-11-14T10:00:00.000Z',
    })
    expect(snapshot.namespaces).toEqual([
      { name: 'finance' },
      { name: 'public', comment: 'The tenant data.' },
    ])
    expect(snapshot.tables.map((table) => `${table.schema}.${table.name}`)).toEqual([
      'public.account_view',
      'public.accounts',
      'public.owners',
    ])

    const accounts = snapshot.tables[1]
    expect(accounts).toMatchObject({
      kind: 'table',
      primaryKey: ['id'],
      unique: [['email'], ['owner_id', 'region']],
      foreignKeys: [
        {
          columns: ['owner_id'],
          references: { schema: 'public', table: 'owners', columns: ['id'] },
        },
      ],
    })
    expect(accounts?.comment).toBeUndefined()
    expect(accounts?.columns[0]).toMatchObject({ name: 'id', type: 'uuid', primaryKey: true })
    expect(accounts?.columns[1]).toMatchObject({
      name: 'email',
      unique: true,
      comment: 'The address a sign-in uses.',
    })
    expect(accounts?.columns[2]).toMatchObject({
      name: 'owner_id',
      nullable: true,
      primaryKey: false,
      unique: false,
      references: { schema: 'public', table: 'owners', columns: ['id'] },
    })
    expect(accounts?.columns[3]).toMatchObject({ name: 'region', default: "'eu'::text" })
    expect(snapshot.tables[0]?.kind).toBe('view')
    expect(snapshot.tables[0]?.columns).toHaveLength(1)
  })

  it('reads function identity, volatility and security', () => {
    const snapshot = assemblePostgresSchema(rows, options)

    expect(snapshot.functions).toEqual([
      {
        schema: 'public',
        name: 'capture',
        signature: 'public.capture(uuid, text)',
        returns: 'void',
        language: 'plpgsql',
        volatility: 'volatile',
        securityDefiner: true,
      },
      {
        schema: 'public',
        name: 'owner_name',
        signature: 'public.owner_name(uuid)',
        returns: 'text',
        language: 'sql',
        volatility: 'immutable',
        securityDefiner: false,
        comment: 'Returns the owner name for an id, or NULL.',
      },
    ])
  })

  it('runs the six queries in order and passes the schema filter', async () => {
    const calls: { sql: string; values: unknown[] | undefined }[] = []
    const client = {
      async query(sql: string, values?: unknown[]) {
        calls.push({ sql, values })
        if (sql.includes('from pg_namespace n')) return { rows: rows.namespaces }
        if (sql.includes('from pg_attribute a')) return { rows: rows.columns }
        if (sql.includes('from pg_index')) return { rows: rows.keys }
        if (sql.includes('from pg_constraint')) return { rows: rows.foreignKeys }
        if (sql.includes('from pg_proc')) return { rows: rows.functions }
        return { rows: rows.relations }
      },
    }

    const snapshot = await readPostgresSchema(client, options)

    expect(calls).toHaveLength(6)
    expect(calls.every((call) => call.values?.length === 2)).toBe(true)
    expect(snapshot).toEqual(assemblePostgresSchema(rows, options))
  })

  it('omits the schema filter when none is given', async () => {
    const valuesSeen: (unknown[] | undefined)[] = []
    const client = {
      async query(_sql: string, values?: unknown[]) {
        valuesSeen.push(values)
        return { rows: [] }
      },
    }

    await readPostgresSchema(client, { database: 'payments', capturedAt: options.capturedAt })

    expect(valuesSeen).toHaveLength(6)
    expect(valuesSeen.every((values) => values === undefined)).toBe(true)
  })

  it('refuses a row whose shape the catalog cannot produce', () => {
    expect(() =>
      assemblePostgresSchema(
        {
          ...rows,
          columns: [
            {
              schema: 'public',
              table: 'accounts',
              name: 'id',
              type: 'uuid',
              nullable: 'yes',
              ordinal: 1,
            },
          ],
        },
        options,
      ),
    ).toThrow('non-boolean nullable')
  })

  it('refuses an unknown volatility', () => {
    expect(() =>
      assemblePostgresSchema(
        {
          ...rows,
          functions: [
            {
              schema: 'public',
              name: 'owner_name',
              signature: 'public.owner_name(uuid)',
              returns: 'text',
              language: 'sql',
              volatility: 'x',
              security_definer: false,
              comment: null,
            },
          ],
        },
        options,
      ),
    ).toThrow('unknown volatility')
  })
})
