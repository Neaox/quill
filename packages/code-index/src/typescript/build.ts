import { existsSync } from 'node:fs'

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
  const groups = new Map<string, string[]>()
  for (const scopeDir of options.scopes) {
    const scoped = options.files.filter((file) => file.startsWith(`${scopeDir}/src/`))
    if (scoped.length === 0) continue
    // A repository may give each package its own tsconfig (Quill) or one root
    // config that includes every package (the PMS prototype). Use whichever
    // exists, and share one session per config.
    const project = existsSync(`${options.root}/${scopeDir}/tsconfig.json`)
      ? `${options.root}/${scopeDir}/tsconfig.json`
      : `${options.root}/tsconfig.json`
    const queued = groups.get(project) ?? []
    queued.push(...scoped)
    groups.set(project, queued)
  }

  for (const [project, scoped] of groups) {
    const session = openSession(options.root, scope, scoped, project)
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

  linkTypeReferences(files)

  return {
    formatVersion: CODE_INDEX_ARTIFACT_VERSION,
    tool: options.tool,
    commit: headCommit(options.root),
    repo: remoteSlug(options.root) ?? '',
    generatedAt: options.generatedAt,
    files,
  }
}

const TYPE_KINDS = new Set(['type', 'interface', 'class', 'enum'])
const TYPE_TOKEN = /\b[A-Za-z_$][\w$]*\b/g

/**
 * Link a symbol to the named types its own declaration mentions. This is a
 * post-build text pass, not a compiler walk: the declaration and signature
 * already contain the names, and resolving every identifier in every symbol
 * made the index five times slower for little extra precision.
 */
function linkTypeReferences(files: Record<string, CodeFileV1>): void {
  const types = new Map<string, string[]>()
  for (const file of Object.values(files)) {
    for (const symbol of file.symbols) {
      if (!TYPE_KINDS.has(symbol.kind)) continue
      const list = types.get(symbol.name) ?? []
      list.push(symbol.moniker)
      types.set(symbol.name, list)
    }
  }

  for (const [path, file] of Object.entries(files)) {
    files[path] = {
      ...file,
      symbols: file.symbols.map((symbol) => {
        const text = [symbol.signature, symbol.definition, symbol.readableType]
          .filter((part) => part !== undefined)
          .join('\n')
        const refs = new Map<string, { name: string; moniker?: string }>()
        for (const match of text.matchAll(TYPE_TOKEN)) {
          const name = match[0]
          if (name === symbol.name) continue
          const monikers = types.get(name)
          if (monikers === undefined) continue
          const moniker = monikers.length === 1 ? monikers[0] : undefined
          refs.set(name, moniker === undefined ? { name } : { name, moniker })
        }
        return refs.size === 0
          ? symbol
          : {
              ...symbol,
              typeRefs: [...refs.values()].toSorted((left, right) =>
                left.name.localeCompare(right.name),
              ),
            }
      }),
    }
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
