import {
  CODE_INDEX_ARTIFACT_VERSION,
  type CodeFileV1,
  type CodeIndexArtifactV1,
} from '../artifact.ts'
import { headCommit, remoteSlug, worktreeBlobShas, worktreeFiles } from '../git.ts'
import { closeSession, extractFile, loadScope, openSession } from './extract.ts'

export interface BuildCodeIndexOptions {
  readonly root: string
  /** Package directories to extract, such as `packages/domain`. */
  readonly scopes: readonly string[]
  /** Files to read; the caller chooses the corpus so a test is not the whole repository. */
  readonly files: readonly string[]
  readonly tool: string
  /** Supplied by the caller so a build is a pure function of its inputs. */
  readonly generatedAt: string
}

/**
 * The first extractor: TypeScript, through the compiler's own native API. It
 * reads every file once, resolves its types and doc comments, and returns the
 * versioned artifact the server will ingest. It does no caching by itself; the
 * caller uses `plan` and `effectiveSignatures` to decide which files to pass.
 */
export function buildCodeIndex(options: BuildCodeIndexOptions): CodeIndexArtifactV1 {
  const scope = loadScope(options.root, options.scopes)
  const blobs = worktreeBlobShas(options.root, options.files)
  const files: Record<string, CodeFileV1> = {}
  for (const scopeDir of options.scopes) {
    const scoped = options.files.filter((file) => file.startsWith(`${scopeDir}/src/`))
    if (scoped.length === 0) continue
    const session = openSession(
      options.root,
      scope,
      scoped,
      `${options.root}/${scopeDir}/tsconfig.json`,
    )
    try {
      for (const file of scoped) {
        const blob = blobs.get(file)
        if (blob === undefined) continue
        files[file] = { path: file, ...extractFile(session, file, blob) }
      }
    } finally {
      closeSession(session)
    }
  }

  return {
    formatVersion: CODE_INDEX_ARTIFACT_VERSION,
    tool: options.tool,
    commit: headCommit(options.root),
    repo: remoteSlug(options.root) ?? '',
    generatedAt: options.generatedAt,
    files,
  }
}

/** Every TypeScript source file under the scopes' `src`, excluding tests, declarations and generated code. */
export function discoverSourceFiles(root: string, scopes: readonly string[]): readonly string[] {
  return worktreeFiles(root).filter(
    (file) =>
      scopes.some((scope) => file.startsWith(`${scope}/src/`)) &&
      file.endsWith('.ts') &&
      !file.endsWith('.test.ts') &&
      !file.endsWith('.d.ts') &&
      !file.includes('/generated/') &&
      !file.endsWith('.gen.ts'),
  )
}
