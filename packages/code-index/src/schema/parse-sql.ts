import type {
  SchemaColumnV1,
  SchemaDialect,
  SchemaForeignKeyV1,
  SchemaFunctionV1,
  SchemaNamespaceV1,
  SchemaReference,
  SchemaSnapshotV1,
  SchemaTableV1,
} from './types.ts'

export interface ParseSqlOptions {
  readonly dialect: SchemaDialect
  readonly database: string
  readonly source: 'migrations' | 'catalog' | 'orm'
  readonly capturedAt: string
  /** The file the SQL came from, used for the table's declaration line. */
  readonly file?: string
  /** The schema assumed for an unqualified table name. */
  readonly defaultSchema?: string
}

interface Identifier {
  readonly schema?: string
  readonly name: string
}

interface Annotations {
  readonly schemas: ReadonlyMap<string, string>
  readonly tables: ReadonlyMap<string, string>
  readonly columns: ReadonlyMap<string, string>
  readonly functions: ReadonlyMap<string, string>
}

const CONSTRAINT_START = /^(?:CONSTRAINT|PRIMARY\s+KEY|UNIQUE|FOREIGN\s+KEY|CHECK)\b/i
const ANNOTATION =
  /COMMENT\s+ON\s+(SCHEMA|TABLE|VIEW|COLUMN|FUNCTION)\s+((?:"[^"]+"|[^\s(]+)(?:\s*\([^)]*\))?)\s+IS\s+'((?:[^']|'')*)'\s*;/gi

/** A DDL reader for the shapes a migration folder actually uses. It is metadata-only and never runs SQL. */
export function parseSqlSchema(sql: string, options: ParseSqlOptions): SchemaSnapshotV1 {
  const text = stripComments(sql)
  const annotations = readAnnotations(text)
  const tables: SchemaTableV1[] = []
  const functions = readFunctions(text, annotations, options)
  const pattern = /CREATE\s+(TABLE|VIEW)\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s(]+)\s*\(/gi

  for (const match of text.matchAll(pattern)) {
    const kind = (match[1] ?? '').toLowerCase() === 'view' ? 'view' : 'table'
    const rawName = match[2]
    if (rawName === undefined) continue
    const open = (match.index ?? 0) + match[0].length - 1
    const close = matchingParen(text, open)
    if (close === -1) continue
    const identifier = parseIdentifier(rawName)
    const body = text.slice(open + 1, close)
    const sourceLine = lineAt(sql, match.index ?? 0)
    if (kind === 'view') {
      const comment = annotations.tables.get(fullName(identifier, options))
      tables.push({
        schema: identifier.schema ?? options.defaultSchema ?? 'public',
        name: identifier.name,
        kind,
        columns: [],
        primaryKey: [],
        unique: [],
        foreignKeys: [],
        ...(comment === undefined ? {} : { comment }),
        ...(options.file === undefined ? {} : { source: { file: options.file, line: sourceLine } }),
      })
    } else {
      tables.push(parseTable(body, identifier, options, sourceLine, annotations))
    }
  }

  const viewPattern = /CREATE\s+VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s]+)\s+AS/gi
  for (const match of text.matchAll(viewPattern)) {
    const rawName = match[1]
    if (rawName === undefined) continue
    const identifier = parseIdentifier(rawName)
    const name = fullName(identifier, options)
    const comment = annotations.tables.get(name)
    tables.push({
      schema: identifier.schema ?? options.defaultSchema ?? 'public',
      name: identifier.name,
      kind: 'view',
      columns: [],
      primaryKey: [],
      unique: [],
      foreignKeys: [],
      ...(comment === undefined ? {} : { comment }),
      ...(options.file === undefined
        ? {}
        : { source: { file: options.file, line: lineAt(sql, match.index ?? 0) } }),
    })
  }

  const namespaces = readNamespaces(tables, functions, annotations)

  return {
    formatVersion: 1,
    dialect: options.dialect,
    database: options.database,
    source: options.source,
    capturedAt: options.capturedAt,
    tables: tables.toSorted(
      (left, right) =>
        left.schema.localeCompare(right.schema) ||
        left.name.localeCompare(right.name) ||
        left.kind.localeCompare(right.kind),
    ),
    namespaces,
    functions,
  }
}

function parseTable(
  body: string,
  identifier: Identifier,
  options: ParseSqlOptions,
  line: number,
  annotations: Annotations,
): SchemaTableV1 {
  const columns: SchemaColumnV1[] = []
  const primaryKey: string[] = []
  const unique: string[][] = []
  const foreignKeys: SchemaForeignKeyV1[] = []

  for (const part of splitTopLevel(body)) {
    const item = part.trim()
    if (item === '') continue
    if (CONSTRAINT_START.test(item)) {
      readTableConstraint(item, primaryKey, unique, foreignKeys)
      continue
    }
    const column = readColumn(item, columns.length + 1)
    if (column !== undefined) columns.push(column)
  }

  const tableName = fullName(identifier, options)
  const annotatedColumns = columns.map((column) => {
    const comment = annotations.columns.get(`${tableName}.${column.name}`)
    return comment === undefined ? column : { ...column, comment }
  })
  const inlinePrimary = annotatedColumns
    .filter((column) => column.primaryKey)
    .map((column) => column.name)
  const inlineUnique = annotatedColumns
    .filter((column) => column.unique)
    .map((column) => [column.name])
  const inlineForeign = annotatedColumns.flatMap((column) =>
    column.references === undefined
      ? []
      : [{ columns: [column.name], references: column.references }],
  )
  const comment = annotations.tables.get(tableName)

  return {
    schema: identifier.schema ?? options.defaultSchema ?? 'public',
    name: identifier.name,
    kind: 'table',
    columns: annotatedColumns,
    primaryKey: primaryKey.length > 0 ? primaryKey : inlinePrimary,
    unique: [...unique, ...inlineUnique],
    foreignKeys: [...foreignKeys, ...inlineForeign],
    ...(comment === undefined ? {} : { comment }),
    ...(options.file === undefined ? {} : { source: { file: options.file, line } }),
  }
}

function readColumn(item: string, ordinal: number): SchemaColumnV1 | undefined {
  const name = readIdentifierAt(item, 0)
  if (name === undefined) return undefined
  const afterName = item.slice(name.end).trimStart()
  if (afterName === '') return undefined
  const type = readType(afterName)
  if (type === '') return undefined
  const rest = afterName.slice(type.length)
  const notNull = /\bNOT\s+NULL\b/i.test(rest)
  const primaryKey = /\bPRIMARY\s+KEY\b/i.test(rest)
  const unique = /\bUNIQUE\b/i.test(rest)
  const defaultValue =
    /\bDEFAULT\s+(.+?)(?=\s+(?:NOT\s+NULL|NULL|PRIMARY\s+KEY|UNIQUE|REFERENCES|CHECK|COLLATE|GENERATED)\b|$)/i.exec(
      rest,
    )?.[1]
  const reference = /\bREFERENCES\s+([^\s(]+)\s*(?:\(([^)]*)\))?/i.exec(rest)

  return {
    name: name.value,
    type: type.trim(),
    nullable: !notNull && !primaryKey,
    ...(defaultValue === undefined ? {} : { default: defaultValue.trim() }),
    ordinal,
    primaryKey,
    unique,
    ...(reference === null
      ? {}
      : {
          references: parseReference(reference[1] ?? '', reference[2]),
        }),
  }
}

function readTableConstraint(
  item: string,
  primaryKey: string[],
  unique: string[][],
  foreignKeys: SchemaForeignKeyV1[],
): void {
  const withoutName = item.replace(/^CONSTRAINT\s+[^\s]+\s+/i, '')
  const primary = /^PRIMARY\s+KEY\s*\(([^)]*)\)/i.exec(withoutName)
  if (primary !== null) {
    primaryKey.push(...readColumns(primary[1] ?? ''))
    return
  }
  const uniqueMatch = /^UNIQUE\s*\(([^)]*)\)/i.exec(withoutName)
  if (uniqueMatch !== null) {
    unique.push(readColumns(uniqueMatch[1] ?? ''))
    return
  }
  const foreign = /^FOREIGN\s+KEY\s*\(([^)]*)\)\s*REFERENCES\s+([^\s(]+)\s*(?:\(([^)]*)\))?/i.exec(
    withoutName,
  )
  if (foreign !== null) {
    foreignKeys.push({
      columns: readColumns(foreign[1] ?? ''),
      references: parseReference(foreign[2] ?? '', foreign[3]),
    })
  }
}

function readFunctions(
  text: string,
  annotations: Annotations,
  options: ParseSqlOptions,
): SchemaFunctionV1[] {
  const functions: SchemaFunctionV1[] = []
  const pattern = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([^\s(]+)\s*\(([^)]*)\)/gi
  for (const match of text.matchAll(pattern)) {
    const rawName = match[1]
    if (rawName === undefined) continue
    const identifier = parseIdentifier(rawName)
    const name = fullName(identifier, options)
    const header = text.slice(
      match.index ?? 0,
      boundaryAfter(text, (match.index ?? 0) + match[0].length),
    )
    const returns =
      /\bRETURNS\s+([^;]+?)(?=\s+(?:LANGUAGE|AS|IMMUTABLE|STABLE|VOLATILE|SECURITY|RETURN|BEGIN)\b|$)/i.exec(
        header,
      )?.[1]
    const language = /\bLANGUAGE\s+([A-Za-z0-9_]+)/i.exec(header)?.[1]
    const volatility = /\b(IMMUTABLE|STABLE|VOLATILE)\b/i.exec(header)?.[1]?.toLowerCase()
    const comment = annotations.functions.get(name) ?? annotations.functions.get(identifier.name)
    functions.push({
      schema: identifier.schema ?? options.defaultSchema ?? 'public',
      name: identifier.name,
      signature: `${identifier.name}(${(match[2] ?? '').trim().replaceAll(/\s+/g, ' ')})`,
      ...(returns === undefined ? {} : { returns: returns.trim().replaceAll(/\s+/g, ' ') }),
      ...(language === undefined ? {} : { language }),
      ...(volatility === 'immutable' || volatility === 'stable' || volatility === 'volatile'
        ? { volatility }
        : {}),
      securityDefiner: /\bSECURITY\s+DEFINER\b/i.test(header),
      ...(comment === undefined ? {} : { comment }),
      ...(options.file === undefined
        ? {}
        : { source: { file: options.file, line: lineAt(text, match.index ?? 0) } }),
    })
  }
  return functions.toSorted(
    (left, right) => left.schema.localeCompare(right.schema) || left.name.localeCompare(right.name),
  )
}

function readNamespaces(
  tables: readonly SchemaTableV1[],
  functions: readonly SchemaFunctionV1[],
  annotations: Annotations,
): SchemaNamespaceV1[] {
  const names = new Set<string>([
    ...tables.map((table) => table.schema),
    ...functions.map((fn) => fn.schema),
    ...annotations.schemas.keys(),
  ])
  return [...names].toSorted().map((name) => {
    const comment = annotations.schemas.get(name)
    return comment === undefined ? { name } : { name, comment }
  })
}

function readAnnotations(text: string): Annotations {
  const schemas = new Map<string, string>()
  const tables = new Map<string, string>()
  const columns = new Map<string, string>()
  const functions = new Map<string, string>()
  for (const match of text.matchAll(ANNOTATION)) {
    const kind = (match[1] ?? '').toUpperCase()
    const target = (match[2] ?? '').replaceAll(/\s+/g, '')
    const comment = unquoteLiteral(match[3] ?? '')
    if (kind === 'SCHEMA') schemas.set(stripQuotes(target), comment)
    else if (kind === 'COLUMN') columns.set(target.replaceAll('"', ''), comment)
    else if (kind === 'FUNCTION')
      functions.set(target.replace(/\(.*$/, '').replaceAll('"', ''), comment)
    else tables.set(target.replaceAll('"', ''), comment)
  }
  return { schemas, tables, columns, functions }
}

function boundaryAfter(text: string, from: number): number {
  const rest = text.slice(from)
  const match = /\b(?:AS|BEGIN|RETURN)\b/i.exec(rest)
  return match === null ? text.length : from + match.index
}

function fullName(identifier: Identifier, options: ParseSqlOptions): string {
  return `${identifier.schema ?? options.defaultSchema ?? 'public'}.${identifier.name}`
}

function unquoteLiteral(value: string): string {
  return value.replaceAll("''", "'")
}

function stripQuotes(value: string): string {
  return value.replace(/^["'`]|["'`]$/g, '')
}

function parseReference(table: string, columns: string | undefined): SchemaReference {
  const identifier = parseIdentifier(table)
  return {
    ...(identifier.schema === undefined ? {} : { schema: identifier.schema }),
    table: identifier.name,
    columns: readColumns(columns ?? ''),
  }
}

function readColumns(value: string): string[] {
  return splitTopLevel(value)
    .map((column) => column.trim().replace(/^["'`]|["'`]$/g, ''))
    .filter((column) => column !== '')
}

/** A type is everything before the first constraint keyword, including `numeric(12, 2)` and `text[]`. */
function readType(value: string): string {
  const constraint =
    /(?:NOT\s+NULL|NULL|DEFAULT|PRIMARY\s+KEY|UNIQUE|REFERENCES|CHECK|COLLATE|GENERATED)/i.exec(
      value,
    )
  return (constraint === null ? value : value.slice(0, constraint.index)).trim()
}

function readIdentifierAt(
  value: string,
  start: number,
): { value: string; end: number } | undefined {
  const quote = value[start]
  if (quote === '"' || quote === "'" || quote === '`') {
    const close = value.indexOf(quote, start + 1)
    if (close === -1) return undefined
    return { value: value.slice(start + 1, close), end: close + 1 }
  }
  const match = /^[A-Za-z_][\w$]*/.exec(value.slice(start))
  if (match === null) return undefined
  const end = start + match[0].length
  const dot = value.slice(end).match(/^\.([A-Za-z_][\w$]*|"[^"]+")/)
  if (dot === null) return { value: match[0], end }
  return { value: dot[1]?.replaceAll('"', '') ?? match[0], end: end + dot[0].length }
}

function parseIdentifier(value: string): Identifier {
  const parts = value
    .split('.')
    .map((part) => part.trim().replace(/^["'`]|["'`]$/g, ''))
    .filter((part) => part !== '')
  const name = parts.at(-1) ?? value
  return parts.length > 1 ? { schema: parts.slice(0, -1).join('.'), name } : { name }
}

function splitTopLevel(value: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quote: string | undefined
  let start = 0
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (quote !== undefined) {
      if (character === quote) quote = undefined
      continue
    }
    if (character === '"' || character === "'" || character === '`') {
      quote = character
      continue
    }
    if (character === '(') depth += 1
    else if (character === ')') depth -= 1
    else if (character === ',' && depth === 0) {
      parts.push(value.slice(start, index))
      start = index + 1
    }
  }
  parts.push(value.slice(start))
  return parts
}

function matchingParen(value: string, open: number): number {
  let depth = 0
  let quote: string | undefined
  for (let index = open; index < value.length; index += 1) {
    const character = value[index]
    if (quote !== undefined) {
      if (character === quote) quote = undefined
      continue
    }
    if (character === '"' || character === "'" || character === '`') {
      quote = character
      continue
    }
    if (character === '(') depth += 1
    else if (character === ')') {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return -1
}

function stripComments(value: string): string {
  return value.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/--[^\n]*/g, '')
}

function lineAt(value: string, index: number): number {
  let line = 1
  for (let cursor = 0; cursor < index; cursor += 1) if (value[cursor] === '\n') line += 1
  return line
}
