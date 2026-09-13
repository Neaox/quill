/**
 * Test harness for the `quill` oxlint plugin rules.
 *
 * Runs the real `oxlint` binary against fixture files through
 * `node:child_process`, the same way the CLI runs in the editor and the
 * gate, so a passing test means the plugin actually loads and the rule
 * actually fires under the real loader — not just that a hand-written
 * mock of the API agrees with itself.
 */
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import {
  copyFileSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const FIXTURES_ROOT = join(import.meta.dirname, '..', 'fixtures')

/** Absolute paths to every fixture file under `fixtures/<ruleName>/<group>`. */
export function fixtureFiles(ruleName: string, group: 'valid' | 'invalid'): string[] {
  const dir = join(FIXTURES_ROOT, ruleName, group)
  return readdirSync(dir).map((name) => join(dir, name))
}

/**
 * Copies every file from `fixtures/<ruleName>/<group>` into a fresh temp
 * directory (so a fix test never mutates the checked-in fixture) and
 * returns the copy's directory plus the copied path for `fileName`.
 */
export function copyFixtureGroup(
  ruleName: string,
  group: 'valid' | 'invalid',
  fileName: string,
): { dir: string; targetPath: string } {
  const sourceDir = join(FIXTURES_ROOT, ruleName, group)
  const dir = mkdtempSync(join(tmpdir(), 'quill-oxlint-fixture-'))
  for (const name of readdirSync(sourceDir)) {
    copyFileSync(join(sourceDir, name), join(dir, name))
  }
  return { dir, targetPath: join(dir, fileName) }
}

export function readFixedFile(path: string): string {
  return readFileSync(path, 'utf8')
}

const require = createRequire(import.meta.url)
const oxlintBin = join(dirname(require.resolve('oxlint/package.json')), 'bin', 'oxlint')
const pluginPath = join(import.meta.dirname, '..', 'index.js')

export interface OxlintDiagnostic {
  readonly ruleId: string
  readonly message: string
  readonly filename: string
  readonly line: number
  readonly column: number
}

export interface RunOxlintResult {
  readonly diagnostics: OxlintDiagnostic[]
  readonly exitCode: number
}

/**
 * Runs oxlint with only `quill/<ruleName>` enabled (every other rule and
 * category is switched off with `-A all`) against the given files.
 */
export function runRule(
  ruleName: string,
  filePaths: string[],
  options: { fix?: boolean } = {},
): RunOxlintResult {
  const configDir = mkdtempSync(join(tmpdir(), 'quill-oxlint-test-'))
  const configPath = join(configDir, '.oxlintrc.json')
  writeFileSync(
    configPath,
    JSON.stringify({
      jsPlugins: [pluginPath.replaceAll('\\', '/')],
      rules: { [`quill/${ruleName}`]: 'error' },
    }),
  )

  const args = ['-c', configPath, '-A', 'all', '-f', 'json']
  if (options.fix) args.push('--fix')
  args.push(...filePaths)

  let stdout = ''
  let exitCode = 0
  try {
    stdout = execFileSync(process.execPath, [oxlintBin, ...args], { encoding: 'utf8' })
  } catch (error) {
    const execError = error as { stdout?: string; status?: number | null }
    stdout = execError.stdout ?? ''
    exitCode = execError.status ?? 1
  } finally {
    rmSync(configDir, { recursive: true, force: true })
  }

  return { diagnostics: parseDiagnostics(stdout, ruleName), exitCode }
}

interface RawDiagnostic {
  message: string
  code: string
  filename: string
  labels?: { span?: { line?: number; column?: number } }[]
}

function parseDiagnostics(stdout: string, ruleName: string): OxlintDiagnostic[] {
  const jsonStart = stdout.indexOf('{')
  if (jsonStart === -1) return []
  const parsed = JSON.parse(stdout.slice(jsonStart)) as { diagnostics: RawDiagnostic[] }
  return parsed.diagnostics
    .filter((diagnostic) => diagnostic.code === `quill(${ruleName})`)
    .map((diagnostic) => ({
      ruleId: diagnostic.code,
      message: diagnostic.message,
      filename: diagnostic.filename,
      line: diagnostic.labels?.[0]?.span?.line ?? 0,
      column: diagnostic.labels?.[0]?.span?.column ?? 0,
    }))
}
