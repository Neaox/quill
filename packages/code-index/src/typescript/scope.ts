/** A package whose symbols the index records. */
export interface ScopePackage {
  /** The package directory, from the repository root: `packages/domain`. */
  readonly dir: string
  readonly name: string
  /** Files a `package.json` export points at, relative to the repository root. */
  readonly entryFiles: ReadonlySet<string>
  /** `@quill/domain/money` -> `packages/domain/src/money/index.ts`. */
  readonly specifiers: ReadonlyMap<string, string>
}
