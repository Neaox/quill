import type { CodeSymbolV1, SymbolUsage } from '../artifact.ts'

/** What the extractor writes for one file, before the build adds its path. */
export interface ExtractedFile {
  readonly blob: string
  readonly symbols: readonly CodeSymbolV1[]
  readonly usages: readonly SymbolUsage[]
  readonly imports: readonly string[]
  readonly reexports: readonly string[]
  readonly signature: string
}
