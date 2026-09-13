/**
 * Rewrites the package scope, imports, development defaults, and
 * documentation from the "Quill" code name to a new product name in one
 * reviewed change (see the plan document, section 6, and
 * `docs/operations/renaming.md`).
 *
 * Usage:
 *   node scripts/rename.ts --name "NewName" --slug newname [--scope @newscope] [--dry-run] [--root <dir>]
 *
 * `--dry-run` prints every file that would change and how many
 * replacements it would make, without writing anything.
 * `--root <dir>` renames a different directory tree instead of the current
 * working directory; it exists so the script can be tested against a copy
 * of the repository without touching the real one.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

interface Options {
  readonly name: string
  readonly slug: string
  readonly scope: string
  readonly dryRun: boolean
  readonly root: string
}

interface Replacement {
  readonly pattern: RegExp
  readonly value: string
}

const SLUG_PATTERN = /^[a-z][a-z0-9-]*$/
const SCOPE_PATTERN = /^@[a-z0-9-]+$/

const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', 'coverage', '.git'])
const SKIPPED_FILES = new Set(['pnpm-lock.yaml'])
const BRAND_FILE = 'packages/brand/src/index.ts'

function printUsage(): void {
  console.error(
    'Usage: node scripts/rename.ts --name "NewName" --slug newname [--scope @newscope] [--dry-run] [--root <dir>]',
  )
}

function parseArgs(argv: readonly string[]): Options {
  let name: string | undefined
  let slug: string | undefined
  let scope: string | undefined
  let dryRun = false
  let root = process.cwd()

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--name') {
      name = argv[++index]
    } else if (arg === '--slug') {
      slug = argv[++index]
    } else if (arg === '--scope') {
      scope = argv[++index]
    } else if (arg === '--root') {
      root = argv[++index] ?? root
    } else if (arg === '--dry-run') {
      dryRun = true
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  if (name === undefined || name.trim().length === 0) {
    throw new Error('--name is required and must be non-empty')
  }
  if (slug === undefined || !SLUG_PATTERN.test(slug)) {
    throw new Error(`--slug is required and must match ${SLUG_PATTERN.source}`)
  }
  const resolvedScope = scope ?? `@${slug}`
  if (!SCOPE_PATTERN.test(resolvedScope)) {
    throw new Error(`--scope must match ${SCOPE_PATTERN.source}, received "${resolvedScope}"`)
  }

  return { name, slug, scope: resolvedScope, dryRun, root }
}

function toPosix(path: string): string {
  return path.split(sep).join('/')
}

function isPlanDocument(fileName: string): boolean {
  return fileName.startsWith('quill-plan')
}

function looksBinary(buffer: Buffer): boolean {
  const sampleLength = Math.min(buffer.length, 8000)
  for (let index = 0; index < sampleLength; index += 1) {
    if (buffer[index] === 0) return true
  }
  return false
}

function collectFiles(dir: string, results: string[]): void {
  const entries = readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue
      collectFiles(join(dir, entry.name), results)
      continue
    }
    if (!entry.isFile()) continue
    if (SKIPPED_FILES.has(entry.name)) continue
    if (isPlanDocument(entry.name)) continue
    results.push(join(dir, entry.name))
  }
}

function buildReplacements(options: Options): Replacement[] {
  const upperSlug = options.slug.toUpperCase()
  return [
    // The npm scope. Matched first so the slug pass below does not also
    // have to special-case the "@" prefix.
    { pattern: /@quill\//g, value: `${options.scope}/` },
    // The doubled dev credential in docker-compose.yml and .env.example
    // (e.g. MINIO_ROOT_PASSWORD). Matched before the whole-word pass below
    // because "quillquill" has no internal word boundary for \b to find.
    { pattern: /quillquill/g, value: `${options.slug}${options.slug}` },
    // The lowercase identifier: container image, db defaults, credentials.
    // "quill-plan"/"quill-plan-review" is excluded: those historical
    // planning documents keep their filename forever (see isPlanDocument),
    // so references to them by name must not be rewritten either.
    { pattern: /\bquill\b(?!-plan)/g, value: options.slug },
    // The display name. "Quill.js" is excluded: it is the name of the
    // unrelated third-party editor discussed in ADR-003 and ADR-026, not
    // this project, and must not be rewritten.
    { pattern: /\bQuill\b(?!-plan)(?!\.js)/g, value: options.name },
    // The shouty variant, if it is ever introduced.
    { pattern: /\bQUILL\b(?!-PLAN)/g, value: upperSlug },
  ]
}

function applyReplacements(
  content: string,
  replacements: readonly Replacement[],
): {
  content: string
  count: number
} {
  let next = content
  let count = 0
  for (const { pattern, value } of replacements) {
    next = next.replace(pattern, () => {
      count += 1
      return value
    })
  }
  return { content: next, count }
}

function renameFile(
  file: string,
  relativePath: string,
  replacements: readonly Replacement[],
  options: Options,
): number {
  const buffer = readFileSync(file)
  if (looksBinary(buffer)) return 0

  const original = buffer.toString('utf8')
  const { content, count } = applyReplacements(original, replacements)

  const isBrandFile = relativePath === BRAND_FILE
  const brandMarker = 'codeName: true'
  const brandReplacement = 'codeName: false'
  const finalContent =
    isBrandFile && content.includes(brandMarker)
      ? content.replace(brandMarker, brandReplacement)
      : content
  const finalCount = isBrandFile && content.includes(brandMarker) ? count + 1 : count

  if (finalCount === 0) return 0

  if (!options.dryRun) {
    writeFileSync(file, finalContent, 'utf8')
  }

  return finalCount
}

function run(options: Options): void {
  const files: string[] = []
  collectFiles(options.root, files)

  const replacements = buildReplacements(options)
  let changedFiles = 0
  let totalReplacements = 0

  for (const file of files) {
    const relativePath = toPosix(relative(options.root, file))
    const count = renameFile(file, relativePath, replacements, options)
    if (count > 0) {
      changedFiles += 1
      totalReplacements += count
      console.log(`${options.dryRun ? '[dry-run] ' : ''}${relativePath}: ${count} replacement(s)`)
    }
  }

  console.log('')
  console.log(
    `${options.dryRun ? '[dry-run] ' : ''}${changedFiles} file(s), ${totalReplacements} replacement(s) total.`,
  )

  if (options.dryRun) return

  console.log('')
  console.log('Rename applied. Manual follow-ups:')
  console.log('  1. Rename the repository and any remote (e.g. GitHub) to match.')
  console.log('  2. Rename the root directory on disk.')
  console.log('  3. Run `pnpm install` to refresh the lockfile.')
  console.log('  4. Run `pnpm check`.')
  console.log(`  5. Search for anything left behind: git grep -i ${options.slug}`)
}

try {
  const options = parseArgs(process.argv.slice(2))
  run(options)
} catch (error) {
  printUsage()
  console.error('')
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
