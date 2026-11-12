/** A database schema read from DDL or a live catalog (ADR-065). It is metadata only. */

export type SchemaDialect = 'postgres' | 'mysql' | 'sqlite' | 'sqlserver'

export interface SchemaReference {
  readonly schema?: string
  readonly table: string
  readonly columns: readonly string[]
}

export interface SchemaColumnV1 {
  readonly name: string
  readonly type: string
  readonly nullable: boolean
  readonly default?: string
  readonly ordinal: number
  readonly primaryKey: boolean
  readonly unique: boolean
  readonly references?: SchemaReference
  readonly comment?: string
}

export interface SchemaForeignKeyV1 {
  readonly columns: readonly string[]
  readonly references: SchemaReference
}

export interface SchemaTableV1 {
  readonly schema: string
  readonly name: string
  readonly kind: 'table' | 'view'
  readonly columns: readonly SchemaColumnV1[]
  readonly primaryKey: readonly string[]
  readonly unique: readonly (readonly string[])[]
  readonly foreignKeys: readonly SchemaForeignKeyV1[]
  readonly comment?: string
  /** Where the declaration lives, when it came from a migration. */
  readonly source?: { readonly file: string; readonly line: number }
}

export interface SchemaNamespaceV1 {
  readonly name: string
  readonly comment?: string
}

export interface SchemaFunctionV1 {
  readonly schema: string
  readonly name: string
  /** `lockstay_tenant()` or `payments.capture(uuid, text)`. */
  readonly signature: string
  readonly returns?: string
  readonly language?: string
  readonly volatility?: 'immutable' | 'stable' | 'volatile'
  readonly securityDefiner: boolean
  readonly comment?: string
  readonly source?: { readonly file: string; readonly line: number }
}

export interface SchemaSnapshotV1 {
  readonly formatVersion: 1
  readonly dialect: SchemaDialect
  readonly database: string
  readonly source: 'migrations' | 'catalog' | 'orm'
  /** Supplied by the caller, so parsing and assembly stay pure. */
  readonly capturedAt: string
  readonly tables: readonly SchemaTableV1[]
  /** Additive: a reader that predates namespaces ignores them. */
  readonly namespaces?: readonly SchemaNamespaceV1[]
  readonly functions?: readonly SchemaFunctionV1[]
}
