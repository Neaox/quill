import type {
  SchemaColumnV1,
  SchemaForeignKeyV1,
  SchemaFunctionV1,
  SchemaNamespaceV1,
  SchemaReference,
  SchemaSnapshotV1,
  SchemaTableV1,
} from './types.ts'

/**
 * Reads a schema from a live Postgres catalog rather than from migration text.
 *
 * Migration files are a history, not a schema: a table renamed in a later file, a
 * column added by `ALTER TABLE`, and a `COMMENT ON` in a file of its own are all
 * invisible to a reader that parses each file alone. The catalog holds the state
 * those files produced, including every comment.
 *
 * The client is a port, so this package does not depend on `pg`. A caller passes
 * its pool, client or transaction; the six queries run in order on it.
 */

/** The slice of a Postgres client the catalog reader needs. */
export interface PostgresQueryClient {
  query(text: string, values?: unknown[]): Promise<{ readonly rows: readonly unknown[] }>
}

export interface ReadPostgresSchemaOptions {
  readonly database: string
  /** Supplied by the caller, so the reader stays pure and a snapshot is reproducible. */
  readonly capturedAt: string
  /** Schemas to read. Omit to read every schema except the Postgres system ones. */
  readonly schemas?: readonly string[]
}

/** The rows the six catalog queries return, before they are assembled. */
export interface PostgresCatalogRows {
  readonly namespaces: readonly unknown[]
  readonly relations: readonly unknown[]
  readonly columns: readonly unknown[]
  readonly keys: readonly unknown[]
  readonly foreignKeys: readonly unknown[]
  readonly functions: readonly unknown[]
}

const FILTER = `
  and n.nspname not in ('pg_catalog', 'information_schema')
  and n.nspname not like 'pg\\_%'
  and ($1::text[] is null or n.nspname = any($1::text[]))`

const NAMESPACES = `
  select n.nspname as schema, obj_description(n.oid, 'pg_namespace') as comment
  from pg_namespace n
  where true${FILTER}
  order by n.nspname`

const RELATIONS = `
  select n.nspname as schema,
         c.relname as name,
         case when c.relkind in ('v', 'm', 'f') then 'view' else 'table' end as kind,
         obj_description(c.oid, 'pg_class') as comment
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p', 'v', 'm', 'f')
    and not c.relispartition${FILTER}
    and not exists (
      select 1 from pg_depend d
      where d.classid = 'pg_class'::regclass and d.objid = c.oid
        and d.refclassid = 'pg_extension'::regclass
    )
  order by n.nspname, c.relname`

const COLUMNS = `
  select n.nspname as schema,
         c.relname as table,
         a.attname as name,
         format_type(a.atttypid, a.atttypmod) as type,
         not a.attnotnull as nullable,
         pg_get_expr(d.adbin, d.adrelid) as default,
         a.attnum as ordinal,
         col_description(c.oid, a.attnum) as comment
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where c.relkind in ('r', 'p', 'v', 'm', 'f')
    and not c.relispartition
    and a.attnum > 0
    and not a.attisdropped${FILTER}
  order by n.nspname, c.relname, a.attnum`

const KEYS = `
  select n.nspname as schema,
         c.relname as table,
         i.indisprimary as primary,
         array(
           select a.attname
           from generate_subscripts(i.indkey, 1) as s
           join pg_attribute a on a.attrelid = c.oid and a.attnum = i.indkey[s - 1]
           where s <= i.indnkeyatts
           order by s
         ) as columns
  from pg_index i
  join pg_class c on c.oid = i.indrelid
  join pg_namespace n on n.oid = c.relnamespace
  where i.indisunique
    and i.indpred is null
    and i.indexprs is null
    and c.relkind in ('r', 'p')
    and not c.relispartition${FILTER}
  order by n.nspname, c.relname, i.indisprimary desc`

const FOREIGN_KEYS = `
  select n.nspname as schema,
         c.relname as table,
         array(
           select a.attname
           from unnest(con.conkey) with ordinality as k(attnum, ord)
           join pg_attribute a on a.attrelid = c.oid and a.attnum = k.attnum
           order by k.ord
         ) as columns,
         fn.nspname as ref_schema,
         fc.relname as ref_table,
         array(
           select a.attname
           from unnest(con.confkey) with ordinality as k(attnum, ord)
           join pg_attribute a on a.attrelid = fc.oid and a.attnum = k.attnum
           order by k.ord
         ) as ref_columns
  from pg_constraint con
  join pg_class c on c.oid = con.conrelid
  join pg_namespace n on n.oid = c.relnamespace
  join pg_class fc on fc.oid = con.confrelid
  join pg_namespace fn on fn.oid = fc.relnamespace
  where con.contype = 'f'${FILTER}
  order by n.nspname, c.relname, 3`

const FUNCTIONS = `
  select n.nspname as schema,
         p.proname as name,
         n.nspname || '.' || p.proname || '(' || oidvectortypes(p.proargtypes) || ')' as signature,
         pg_get_function_result(p.oid) as returns,
         l.lanname as language,
         p.provolatile as volatility,
         p.prosecdef as security_definer,
         obj_description(p.oid, 'pg_proc') as comment
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_language l on l.oid = p.prolang
  where p.prokind = 'f'${FILTER}
    and not exists (
      select 1 from pg_depend d
      where d.classid = 'pg_proc'::regclass and d.objid = p.oid
        and d.refclassid = 'pg_extension'::regclass
    )
  order by n.nspname, p.proname, 3`

/** Runs the six catalog queries and assembles their rows into a snapshot. */
export const readPostgresSchema = async (
  client: PostgresQueryClient,
  options: ReadPostgresSchemaOptions,
): Promise<SchemaSnapshotV1> => {
  const values = options.schemas === undefined ? undefined : [...options.schemas]
  const rows: PostgresCatalogRows = {
    namespaces: (await client.query(NAMESPACES, values)).rows,
    relations: (await client.query(RELATIONS, values)).rows,
    columns: (await client.query(COLUMNS, values)).rows,
    keys: (await client.query(KEYS, values)).rows,
    foreignKeys: (await client.query(FOREIGN_KEYS, values)).rows,
    functions: (await client.query(FUNCTIONS, values)).rows,
  }
  return assemblePostgresSchema(rows, options)
}

/** Assembles catalog rows without a database, so the mapping is testable on its own. */
export const assemblePostgresSchema = (
  rows: PostgresCatalogRows,
  options: ReadPostgresSchemaOptions,
): SchemaSnapshotV1 => {
  const namespaces = new Map<string, SchemaNamespaceV1>()
  for (const row of rows.namespaces) {
    const name = text(row, 'schema')
    const comment = optionalText(row, 'comment')
    namespaces.set(name, comment === undefined ? { name } : { name, comment })
  }

  const columns = new Map<string, SchemaColumnV1[]>()
  for (const row of rows.columns) {
    const table = relationKey(text(row, 'schema'), text(row, 'table'))
    const defaultValue = optionalText(row, 'default')
    const comment = optionalText(row, 'comment')
    const column: SchemaColumnV1 = {
      name: text(row, 'name'),
      type: text(row, 'type'),
      nullable: flag(row, 'nullable'),
      ...(defaultValue === undefined ? {} : { default: defaultValue }),
      ordinal: number(row, 'ordinal'),
      primaryKey: false,
      unique: false,
      ...(comment === undefined ? {} : { comment }),
    }
    columns.set(table, [...(columns.get(table) ?? []), column])
  }

  const primaryKeys = new Map<string, readonly string[]>()
  const uniqueKeys = new Map<string, (readonly string[])[]>()
  const primaryColumns = new Set<string>()
  const uniqueColumns = new Set<string>()
  for (const row of rows.keys) {
    const table = relationKey(text(row, 'schema'), text(row, 'table'))
    const keyColumns = strings(row, 'columns')
    if (keyColumns.length === 0) continue
    if (flag(row, 'primary')) {
      primaryKeys.set(table, keyColumns)
      for (const column of keyColumns) primaryColumns.add(columnKey(table, column))
      continue
    }
    uniqueKeys.set(table, [...(uniqueKeys.get(table) ?? []), keyColumns])
    if (keyColumns.length === 1 && keyColumns[0] !== undefined) {
      uniqueColumns.add(columnKey(table, keyColumns[0]))
    }
  }

  const foreignKeys = new Map<string, SchemaForeignKeyV1[]>()
  const columnReferences = new Map<string, SchemaReference>()
  for (const row of rows.foreignKeys) {
    const table = relationKey(text(row, 'schema'), text(row, 'table'))
    const keyColumns = strings(row, 'columns')
    const reference: SchemaReference = {
      schema: text(row, 'ref_schema'),
      table: text(row, 'ref_table'),
      columns: strings(row, 'ref_columns'),
    }
    const foreignKey: SchemaForeignKeyV1 = { columns: keyColumns, references: reference }
    foreignKeys.set(table, [...(foreignKeys.get(table) ?? []), foreignKey])
    if (keyColumns.length === 1 && keyColumns[0] !== undefined) {
      columnReferences.set(columnKey(table, keyColumns[0]), reference)
    }
  }

  const tables: SchemaTableV1[] = []
  for (const row of rows.relations) {
    const schema = text(row, 'schema')
    const name = text(row, 'name')
    const table = relationKey(schema, name)
    const tableColumns = (columns.get(table) ?? [])
      .toSorted((left, right) => left.ordinal - right.ordinal)
      .map((column) => {
        const reference = columnReferences.get(columnKey(table, column.name))
        return {
          ...column,
          primaryKey: primaryColumns.has(columnKey(table, column.name)),
          unique: uniqueColumns.has(columnKey(table, column.name)),
          ...(reference === undefined ? {} : { references: reference }),
        }
      })
    const comment = optionalText(row, 'comment')
    tables.push({
      schema,
      name,
      kind: text(row, 'kind') === 'view' ? 'view' : 'table',
      columns: tableColumns,
      primaryKey: primaryKeys.get(table) ?? [],
      unique: uniqueKeys.get(table) ?? [],
      foreignKeys: foreignKeys.get(table) ?? [],
      ...(comment === undefined ? {} : { comment }),
    })
    if (!namespaces.has(schema)) namespaces.set(schema, { name: schema })
  }

  const functions: SchemaFunctionV1[] = []
  for (const row of rows.functions) {
    const schema = text(row, 'schema')
    const returns = optionalText(row, 'returns')
    const language = optionalText(row, 'language')
    const comment = optionalText(row, 'comment')
    functions.push({
      schema,
      name: text(row, 'name'),
      signature: text(row, 'signature'),
      ...(returns === undefined ? {} : { returns }),
      ...(language === undefined ? {} : { language }),
      volatility: volatility(row),
      securityDefiner: flag(row, 'security_definer'),
      ...(comment === undefined ? {} : { comment }),
    })
    if (!namespaces.has(schema)) namespaces.set(schema, { name: schema })
  }

  return {
    formatVersion: 1,
    dialect: 'postgres',
    database: options.database,
    source: 'catalog',
    capturedAt: options.capturedAt,
    tables: tables.toSorted(compareRelations),
    namespaces: [...namespaces.values()].toSorted((left, right) =>
      left.name.localeCompare(right.name),
    ),
    functions: functions.toSorted(
      (left, right) =>
        left.schema.localeCompare(right.schema) ||
        left.name.localeCompare(right.name) ||
        left.signature.localeCompare(right.signature),
    ),
  }
}

const compareRelations = (left: SchemaTableV1, right: SchemaTableV1): number =>
  left.schema.localeCompare(right.schema) ||
  left.name.localeCompare(right.name) ||
  left.kind.localeCompare(right.kind)

const relationKey = (schema: string, name: string): string => `${schema}.${name}`

const columnKey = (table: string, column: string): string => `${table}.${column}`

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const field = (row: unknown, key: string): unknown => {
  if (!isRecord(row)) throw new Error('A Postgres catalog row is not an object')
  return row[key]
}

const text = (row: unknown, key: string): string => {
  const value = field(row, key)
  if (typeof value !== 'string') {
    throw new Error(`A Postgres catalog row has no string ${key}`)
  }
  return value
}

const optionalText = (row: unknown, key: string): string | undefined => {
  const value = field(row, key)
  if (value === null || value === undefined) return undefined
  if (typeof value !== 'string') {
    throw new Error(`A Postgres catalog row has a non-string ${key}`)
  }
  return value
}

const flag = (row: unknown, key: string): boolean => {
  const value = field(row, key)
  if (typeof value !== 'boolean') {
    throw new Error(`A Postgres catalog row has a non-boolean ${key}`)
  }
  return value
}

const number = (row: unknown, key: string): number => {
  const value = field(row, key)
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`A Postgres catalog row has a non-integer ${key}`)
  }
  return value
}

const strings = (row: unknown, key: string): readonly string[] => {
  const value = field(row, key)
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`A Postgres catalog row has no string array ${key}`)
  }
  return value
}

type Volatility = NonNullable<SchemaFunctionV1['volatility']>

const volatility = (row: unknown): Volatility => {
  const value = field(row, 'volatility')
  if (value === 'i') return 'immutable'
  if (value === 's') return 'stable'
  if (value === 'v') return 'volatile'
  throw new Error('A Postgres catalog function has an unknown volatility')
}
