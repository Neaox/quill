export {
  CODE_INDEX_ARTIFACT_VERSION,
  decodeCodeIndexArtifact,
  encodeCodeIndexArtifact,
  type ArtifactIssue,
  type ArtifactResult,
  type CodeFileV1,
  type CodeIndexArtifact,
  type CodeIndexArtifactV1,
  type CodeSymbolV1,
  type DocTag,
  type SourceParameter,
  type SymbolKind,
  type SymbolUsage,
  type TypeReference,
  type SymbolVisibility,
} from './artifact.ts'
export {
  cacheKey,
  digest,
  effectiveSignatures,
  plan,
  type CacheKeyParts,
  type Plan,
} from './cache.ts'
export {
  blobShas,
  commitsBehind,
  git,
  headCommit,
  remoteSlug,
  worktreeBlobShas,
  worktreeFiles,
} from './git.ts'

export { buildCodeIndexReport, type CodeIndexReport } from './report.ts'
export {
  assemblePostgresSchema,
  parseSqlSchema,
  readPostgresSchema,
  type ParseSqlOptions,
  type PostgresCatalogRows,
  type PostgresQueryClient,
  type ReadPostgresSchemaOptions,
  type SchemaColumnV1,
  type SchemaDialect,
  type SchemaForeignKeyV1,
  type SchemaFunctionV1,
  type SchemaNamespaceV1,
  type SchemaReference,
  type SchemaSnapshotV1,
  type SchemaTableV1,
} from './schema/index.ts'

export {
  buildCodeIndex,
  closeSession,
  discoverSourceFiles,
  extractFile,
  loadScope,
  openSession,
  packageOf,
  type BuildCodeIndexOptions,
  type ExtractedFile,
  type ScopePackage,
  type Session,
} from './typescript/index.ts'

export {
  schemaDisplay,
  schemaOutputAlias,
  type SchemaDisplay,
} from './typescript/schema-display.ts'
