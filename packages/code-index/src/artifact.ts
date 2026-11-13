import { err, ok, type Result } from '@quill/domain'

/**
 * The code-index artifact (ADR-065). It is the one shape the extractor writes
 * and the server ingests, so a language or a host can be swapped without
 * changing the pages.
 *
 * `formatVersion` follows rule 17: a reader dispatches on it and refuses a
 * version it has never shipped. The artifact is deterministic: the same
 * corpus, tool and commit produce the same bytes, which is what makes a
 * snapshot diff and a cache key meaningful.
 */

export const CODE_INDEX_ARTIFACT_VERSION = 1

export type SymbolKind =
  | 'function'
  | 'const'
  | 'class'
  | 'type'
  | 'interface'
  | 'enum'
  | 'method'
  | 'property'

/** The public surface, a Package-tagged export, a local helper, or a member. */
export type SymbolVisibility = 'exported' | 'internal' | 'package' | 'local'

export interface SourceParameter {
  readonly name: string
  readonly type: string
  readonly optional: boolean
}

export interface DocTag {
  readonly name: string
  readonly text: string
}

export interface TypeReference {
  readonly name: string
  /** Present when the target declaration was in the scanned set. */
  readonly moniker?: string
}

export interface CodeSymbolV1 {
  /** Stable across snapshots within a source: `typescript:packages/domain:packages/domain/src/result.ts#ok`. */
  readonly moniker: string
  readonly name: string
  readonly kind: SymbolKind
  /** The package directory, such as `packages/domain`. */
  readonly package: string
  /** The module below the package's `src`, without an extension. */
  readonly module: string
  readonly file: string
  readonly visibility: SymbolVisibility
  /** Whether the file is an entry file, or is re-exported from one. */
  readonly entryFile: boolean
  readonly signature: string
  /** The declaration's own text, for a type, interface or class. Not a rendered type. */
  readonly definition?: string
  /** A literal constant's value, when the initializer is a string, number or boolean. */
  readonly value?: string
  readonly params: readonly SourceParameter[]
  readonly returnType: string
  readonly description: string
  readonly tags: readonly DocTag[]
  readonly keywords: readonly string[]
  readonly concepts: readonly string[]
  /** Named types mentioned by the declaration: parameters, return type, heritage or a type alias's right side. */
  readonly typeRefs?: readonly TypeReference[]
  /** A readable data shape for a schema-builder value, such as `z.object({...})`. */
  readonly readableType?: string
  /** The named output alias for a schema value: `AccountOpening` for `ACCOUNT_OPENING`. */
  readonly inferredTypeRef?: TypeReference
  /** The schema value a named output alias is defined from. */
  readonly schemaRef?: TypeReference
  readonly startLine: number
  readonly endLine: number
  /** Cyclomatic complexity; functions only. */
  readonly complexity: number | null
}

export interface SymbolUsage {
  /** The moniker of the declaration this use points at. */
  readonly to: string
  readonly line: number
}

export interface CodeFileV1 {
  readonly path: string
  /** The file's Git blob SHA, so an unchanged file reuses its record. */
  readonly blob: string
  readonly symbols: readonly CodeSymbolV1[]
  readonly usages: readonly SymbolUsage[]
  readonly imports: readonly string[]
  readonly reexports: readonly string[]
  /** A digest of the declarations this file makes, used for dependency invalidation. */
  readonly signature: string
}

export interface CodeIndexArtifactV1 {
  readonly formatVersion: typeof CODE_INDEX_ARTIFACT_VERSION
  readonly tool: string
  readonly commit: string
  readonly repo: string
  /** The caller's clock, never read here, so the encoder stays pure. */
  readonly generatedAt: string
  readonly files: Readonly<Record<string, CodeFileV1>>
}

export type CodeIndexArtifact = CodeIndexArtifactV1

export type ArtifactIssue =
  | { readonly code: 'not-json'; readonly detail: string }
  | { readonly code: 'not-an-object'; readonly detail: string }
  | { readonly code: 'unsupported-version'; readonly detail: string }
  | { readonly code: 'invalid-shape'; readonly detail: string }

export type ArtifactResult<T> = Result<T, ArtifactIssue>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Encodes an artifact as one JSON document with a fixed key order, sorted
 * files, symbols, usages and edges. Two runs over the same corpus therefore
 * produce byte-identical output.
 */
export function encodeCodeIndexArtifact(artifact: CodeIndexArtifactV1): string {
  const files = Object.fromEntries(
    Object.entries(artifact.files)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([path, file]) => [
        path,
        {
          path: file.path,
          blob: file.blob,
          symbols: file.symbols.toSorted((left, right) =>
            left.moniker.localeCompare(right.moniker),
          ),
          usages: file.usages.toSorted(
            (left, right) => left.to.localeCompare(right.to) || left.line - right.line,
          ),
          imports: file.imports.toSorted(),
          reexports: file.reexports.toSorted(),
          signature: file.signature,
        },
      ]),
  )

  return `${JSON.stringify(
    {
      formatVersion: artifact.formatVersion,
      tool: artifact.tool,
      commit: artifact.commit,
      repo: artifact.repo,
      generatedAt: artifact.generatedAt,
      files,
    },
    null,
    2,
  )}\n`
}

/** Decodes an artifact, refusing an unknown version or a shape it cannot trust. */
export function decodeCodeIndexArtifact(text: string): ArtifactResult<CodeIndexArtifactV1> {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    return err({ code: 'not-json', detail: error instanceof Error ? error.message : String(error) })
  }

  if (!isRecord(value))
    return err({ code: 'not-an-object', detail: 'the artifact is not an object' })

  const version = value['formatVersion']
  if (version !== CODE_INDEX_ARTIFACT_VERSION) {
    return err({
      code: 'unsupported-version',
      detail: `this reader supports ${CODE_INDEX_ARTIFACT_VERSION}, not ${String(version)}`,
    })
  }

  if (
    typeof value['tool'] !== 'string' ||
    typeof value['commit'] !== 'string' ||
    typeof value['repo'] !== 'string' ||
    typeof value['generatedAt'] !== 'string' ||
    !isRecord(value['files'])
  ) {
    return err({
      code: 'invalid-shape',
      detail: 'a manifest field is missing or has the wrong type',
    })
  }

  for (const [path, file] of Object.entries(value['files'])) {
    if (!isRecord(file) || file['path'] !== path || !Array.isArray(file['symbols'])) {
      return err({ code: 'invalid-shape', detail: `the file record for ${path} is incomplete` })
    }
  }

  return ok(value as unknown as CodeIndexArtifactV1)
}
