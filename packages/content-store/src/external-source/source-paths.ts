import { err, ok } from '@quill/domain'
import type { Result } from '@quill/domain'

/**
 * The paths an external source reads, turned into the literal prefixes the
 * fetch is limited to (ADR-061, "Fetching").
 *
 * A glob is widened to its longest literal directory: `packages/**\/README.md`
 * becomes `packages`, whose files are all fetched, and the reader narrows to
 * the READMEs again. A source with strict prefixes refuses globs instead, so
 * what it holds is exactly the paths it names.
 */

const GLOB_CHARACTERS = /[*?[{]/u

export interface SourcePathsOptions {
  /** Refuse globs rather than widening them. */
  readonly strict: boolean
}

export function sourcePrefixes(
  paths: readonly string[],
  options: SourcePathsOptions,
): Result<readonly string[], string> {
  if (paths.length === 0) return err('A source needs at least one path.')
  const prefixes: string[] = []
  for (const path of paths) {
    const prefix = literalPrefix(path, options)
    if (!prefix.ok) return prefix
    prefixes.push(prefix.value)
  }
  return ok(withoutCovered(prefixes))
}

function literalPrefix(path: string, { strict }: SourcePathsOptions): Result<string, string> {
  const segments = path.replace(/\/+$/u, '').split('/')
  const invalid = segments.find(
    (segment) => segment === '' || segment === '.' || segment === '..' || /[\\\0]/u.test(segment),
  )
  if (invalid !== undefined) {
    return err(`"${path}" is not a relative path of plain segments separated by "/".`)
  }
  const firstGlob = segments.findIndex((segment) => GLOB_CHARACTERS.test(segment))
  if (firstGlob === -1) return ok(segments.join('/'))
  if (strict) return err(`"${path}" is a glob, and this source accepts only literal paths.`)
  // A glob with no literal directory in front of it widens to the whole
  // repository, which is never what a path in a source means to say.
  if (firstGlob === 0) return err(`"${path}" is a glob with no directory to widen it to.`)
  return ok(segments.slice(0, firstGlob).join('/'))
}

/** Drops duplicates and every prefix that another prefix already contains. */
function withoutCovered(prefixes: readonly string[]): readonly string[] {
  const unique = [...new Set(prefixes)].toSorted()
  return unique.filter(
    (prefix) => !unique.some((other) => other !== prefix && prefix.startsWith(`${other}/`)),
  )
}

/**
 * The sparse-checkout patterns that fetch exactly `prefixes`: each prefix as
 * a file, and everything beneath it as a directory.
 *
 * These are non-cone patterns on purpose. Cone mode always includes every
 * file at the repository's root and every file directly inside each parent
 * of a prefix (`docs/guides` brings `README.md` and `docs/*.md` with it),
 * which would put blobs outside the source on the instance.
 */
export function sparsePatterns(prefixes: readonly string[]): readonly string[] {
  return prefixes.flatMap((prefix) => {
    // A literal prefix holds no glob characters, and a leading "/" anchors
    // it, so a space is the only character left that a pattern would read
    // differently (a trailing one is dropped). Escaping every space is valid.
    const escaped = prefix.replaceAll(' ', '\\ ')
    return [`/${escaped}`, `/${escaped}/**`]
  })
}
