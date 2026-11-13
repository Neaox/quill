import { createHash } from 'node:crypto'

import type { CodeFileV1 } from './artifact.ts'

/** Anything that, changed, makes every record untrustworthy: the tool, the compiler, its config, what is in scope, the format. */
export interface CacheKeyParts {
  readonly tool: string
  readonly compiler: string
  readonly tsconfig: string
  readonly formatVersion: number
  /** The scoped packages and each `package.json`'s name, exports and resolved specifiers. */
  readonly scope: string
}

export function cacheKey(parts: CacheKeyParts): string {
  return digest(
    [parts.tool, parts.compiler, parts.tsconfig, String(parts.formatVersion), parts.scope].join(
      '\n',
    ),
  )
}

export function digest(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16)
}

export interface Plan {
  /** Files to extract again, with why. */
  readonly stale: ReadonlyMap<string, 'new' | 'changed' | 'dependency'>
  /** Files whose previous record is reused as it is. */
  readonly reused: readonly string[]
}

/**
 * Which files need extracting. A file is stale when it is new or its blob
 * changed; a file that imports a stale file is stale as well when that file's
 * signature changed, because its resolved types can have moved though its own
 * text has not. That is why this runs in rounds: after each round, the caller
 * asks again with the files whose effective signature moved.
 */
export function plan(
  previous: Readonly<Record<string, CodeFileV1>>,
  blobs: ReadonlyMap<string, string>,
  signatureChanged: ReadonlySet<string> = new Set(),
  dependsOnSignatures: (file: string) => boolean = () => true,
): Plan {
  const stale = new Map<string, 'new' | 'changed' | 'dependency'>()
  const reused: string[] = []
  for (const [file, blob] of blobs) {
    const before = previous[file]
    if (!before) stale.set(file, 'new')
    else if (before.blob !== blob) stale.set(file, 'changed')
  }

  const importersOf = new Map<string, string[]>()
  for (const [file, record] of Object.entries(previous)) {
    for (const imported of record.imports) {
      const list = importersOf.get(imported) ?? []
      list.push(file)
      importersOf.set(imported, list)
    }
  }

  const queue = [...signatureChanged]
  for (let next = queue.pop(); next !== undefined; next = queue.pop()) {
    for (const importer of importersOf.get(next) ?? []) {
      if (!blobs.has(importer) || stale.has(importer) || !dependsOnSignatures(importer)) continue
      stale.set(importer, 'dependency')
    }
  }

  for (const file of blobs.keys()) if (!stale.has(file)) reused.push(file)
  return { stale, reused }
}

/**
 * What each file exposes: its own signature, with that of every file it
 * re-exports. A barrel declares nothing itself, so without this a type
 * changing behind it would move nothing in front of it.
 */
export function effectiveSignatures(
  records: Readonly<Record<string, CodeFileV1>>,
): ReadonlyMap<string, string> {
  const result = new Map<string, string>()
  const visiting = new Set<string>()

  const visit = (file: string): string => {
    const known = result.get(file)
    if (known !== undefined) return known
    const record = records[file]
    if (!record) return ''
    if (visiting.has(file)) return record.signature
    visiting.add(file)
    const value = digest([record.signature, ...record.reexports.map(visit)].join('|'))
    visiting.delete(file)
    result.set(file, value)
    return value
  }

  for (const file of Object.keys(records)) visit(file)
  return result
}
