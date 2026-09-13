/**
 * Changelog fragments: validates the entries contributors add under
 * `.changelog/` and assembles them into `CHANGELOG.md` at release time, so
 * that concurrent pull requests never conflict on the same lines of a
 * shared file (see `.changelog/README.md` for the contributor-facing
 * format).
 *
 * Modelled on Overcast's `scripts/changelog.py`
 * (https://github.com/overcast-sh/overcast): a dated, slugged fragment file
 * per change, collected at release time and deleted. The fragment grammar
 * is simplified from Overcast's (symbols, area tags, breaking markers,
 * migration lines) to plain Keep a Changelog category words: Quill is
 * pre-1.0 and does not yet have Overcast's per-service areas or semver
 * gating, so that machinery would be ceremony without a reader.
 *
 * Usage:
 *   node scripts/changelog.ts check
 *   node scripts/changelog.ts release <version> [--date YYYY-MM-DD] [--root <dir>]
 *
 * `--date` and `--root` exist so `release` can be tested without depending
 * on the real clock or writing into the real repository.
 */
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const FRAGMENTS_DIR = '.changelog'
const CHANGELOG_FILE = 'CHANGELOG.md'
const README_FILE = 'README.md'
const FRAGMENT_NAME_PATTERN = /^\d{8}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/
const ENTRY_LINE_PATTERN = /^(Added|Changed|Deprecated|Removed|Fixed|Security): (.+)$/

/** Keep a Changelog's categories, in the order a release section renders them. */
const CATEGORY_ORDER = ['Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security'] as const

type Category = (typeof CATEGORY_ORDER)[number]

interface Entry {
  readonly category: Category
  readonly prose: string
}

interface Fragment {
  readonly file: string
  readonly entries: readonly Entry[]
}

interface FragmentIssue {
  readonly file: string
  readonly message: string
}

interface ParsedFragment {
  readonly fragment: Fragment | undefined
  readonly issues: readonly FragmentIssue[]
}

function isCategory(value: string): value is Category {
  return CATEGORY_ORDER.some((category) => category === value)
}

/** Lists fragment filenames (everything except the format README), sorted so date order is filename order. */
function listFragmentFiles(root: string): string[] {
  try {
    return readdirSync(join(root, FRAGMENTS_DIR))
      .filter((name) => name !== README_FILE && !name.startsWith('.'))
      .toSorted()
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return []
    throw error
  }
}

/** Parses one fragment's filename and content. Never throws; problems come back as issues. */
function parseFragment(file: string, content: string): ParsedFragment {
  const issues: FragmentIssue[] = []
  if (!FRAGMENT_NAME_PATTERN.test(file)) {
    issues.push({
      file,
      message: 'filename must match YYYYMMDD-slug.md (lowercase letters, digits, hyphens)',
    })
  }

  const lines = content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  if (lines.length === 0) {
    issues.push({ file, message: 'has no entries; add at least one "Category: prose" line' })
  }

  const entries: Entry[] = []
  for (const line of lines) {
    const match = ENTRY_LINE_PATTERN.exec(line)
    const category = match?.[1]
    const prose = match?.[2]
    if (!category || !prose || !isCategory(category)) {
      issues.push({
        file,
        message: `line "${line}" must match "Added|Changed|Deprecated|Removed|Fixed|Security: prose"`,
      })
      continue
    }
    entries.push({ category, prose })
  }

  return { fragment: issues.length === 0 ? { file, entries } : undefined, issues }
}

function readFragmentFile(root: string, file: string): string {
  return readFileSync(join(root, FRAGMENTS_DIR, file), 'utf8')
}

/** Every format problem across every fragment file, empty when all are valid. */
function checkFragments(root: string): FragmentIssue[] {
  return listFragmentFiles(root).flatMap(
    (file) => parseFragment(file, readFragmentFile(root, file)).issues,
  )
}

/** Every valid fragment, in filename (chronological) order. Assumes `checkFragments` is already clean. */
function readFragments(root: string): Fragment[] {
  return listFragmentFiles(root).flatMap((file) => {
    const { fragment } = parseFragment(file, readFragmentFile(root, file))
    return fragment ? [fragment] : []
  })
}

function groupByCategory(fragments: readonly Fragment[]): Map<Category, string[]> {
  const grouped = new Map<Category, string[]>()
  for (const fragment of fragments) {
    for (const entry of fragment.entries) {
      const prose = grouped.get(entry.category)
      if (prose) prose.push(entry.prose)
      else grouped.set(entry.category, [entry.prose])
    }
  }
  return grouped
}

/** Renders a release section body (no leading blank line, one trailing newline). */
function renderSection(version: string, date: string, fragments: readonly Fragment[]): string {
  const grouped = groupByCategory(fragments)
  const blocks = CATEGORY_ORDER.filter((category) => grouped.has(category)).map((category) => {
    const bullets = (grouped.get(category) ?? []).map((prose) => `- ${prose}`).join('\n')
    return `### ${category}\n\n${bullets}`
  })
  return `## [${version}] - ${date}\n\n${blocks.join('\n\n')}\n`
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Inserts a release section directly below `## Unreleased`, preserving
 * everything else in the file. Throws if the version already has a
 * section (release again under a new version instead of re-running one
 * that already landed) or if there is no `## Unreleased` heading to anchor
 * on.
 */
function insertSection(changelog: string, section: string, version: string): string {
  if (new RegExp(`^## \\[${escapeForRegExp(version)}\\] - `, 'm').test(changelog)) {
    throw new Error(
      `${CHANGELOG_FILE} already has a "${version}" section; release under a new version`,
    )
  }

  const unreleased = /^## Unreleased\b.*$/m.exec(changelog)
  if (!unreleased) {
    throw new Error(`${CHANGELOG_FILE} has no "## Unreleased" heading to insert the release after`)
  }

  const nextHeadingAt = changelog.indexOf('\n## ', unreleased.index + unreleased[0].length)
  const headEnd = nextHeadingAt === -1 ? changelog.length : nextHeadingAt
  const head = changelog.slice(0, headEnd).replace(/\n*$/, '\n')
  const tail = changelog.slice(headEnd)
  return `${head}\n${section}${tail}`
}

function formatIssues(issues: readonly FragmentIssue[]): string {
  return issues.map((issue) => `${FRAGMENTS_DIR}/${issue.file}: ${issue.message}`).join('\n')
}

interface ReleaseResult {
  readonly changed: boolean
  readonly message: string
}

/**
 * Collects every fragment into a new `CHANGELOG.md` section and deletes
 * the fragments it used. Idempotent: with no fragments left to collect
 * (the common case for re-running it) it is a no-op, so releasing twice in
 * a row is safe.
 */
function release(root: string, version: string, date: string): ReleaseResult {
  const issues = checkFragments(root)
  if (issues.length > 0) throw new Error(formatIssues(issues))

  const fragments = readFragments(root)
  if (fragments.length === 0) {
    return { changed: false, message: 'No changelog fragments to release; nothing to do.' }
  }

  const section = renderSection(version, date, fragments)
  const changelogPath = join(root, CHANGELOG_FILE)
  const updated = insertSection(readFileSync(changelogPath, 'utf8'), section, version)
  writeFileSync(changelogPath, updated)
  for (const fragment of fragments) rmSync(join(root, FRAGMENTS_DIR, fragment.file))

  return { changed: true, message: `Released ${version} with ${fragments.length} fragment(s).` }
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10)
}

interface ReleaseArgs {
  readonly version: string
  readonly date: string
  readonly root: string
}

function parseReleaseArgs(argv: readonly string[]): ReleaseArgs {
  const [version, ...rest] = argv
  if (!version || version.startsWith('--')) {
    throw new Error('release requires a version, e.g.: node scripts/changelog.ts release 0.1.0')
  }

  let date = todayUtc()
  let root = process.cwd()
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index]
    const value = rest[index + 1]
    if (flag === '--date' && value !== undefined) {
      date = value
      index += 1
    } else if (flag === '--root' && value !== undefined) {
      root = value
      index += 1
    }
  }
  return { version, date, root }
}

function printUsage(): void {
  console.error('Usage: node scripts/changelog.ts check')
  console.error(
    '       node scripts/changelog.ts release <version> [--date YYYY-MM-DD] [--root <dir>]',
  )
}

function main(): void {
  const [command, ...rest] = process.argv.slice(2)

  if (command === 'check') {
    const issues = checkFragments(process.cwd())
    if (issues.length > 0) {
      console.error(formatIssues(issues))
      process.exitCode = 1
      return
    }
    console.log('Changelog fragments are valid.')
    return
  }

  if (command === 'release') {
    try {
      const { version, date, root } = parseReleaseArgs(rest)
      console.log(release(root, version, date).message)
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    }
    return
  }

  printUsage()
  process.exitCode = 1
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) main()

export { checkFragments, insertSection, parseFragment, release, renderSection }
