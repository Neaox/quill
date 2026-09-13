/**
 * Bundle-budget gate (AGENTS.md rule 13; quill-plan.md section 31): reads
 * `apps/web/dist/.vite/manifest.json` and, for each route in `ROUTES`,
 * resolves the transitive set of JS and CSS files loaded on first render —
 * the entry (or dynamic-import chunk) plus everything it reaches through
 * *static* `imports`, never through `dynamicImports` — because a
 * dynamically imported route (the editor, the design showcase, the revision
 * diff view) is exactly the code a reader who never opens it should not pay
 * for (ADR-030). Each file is measured raw and gzipped at level 9, the level
 * the plan's budget is stated in; brotli is reported alongside for
 * information, not gated, since the plan does not set a brotli figure.
 *
 * "KB" throughout means 1024 bytes, matching the budget-tooling convention
 * (webpack's `performance.maxAssetSize`, `size-limit`, Chrome DevTools),
 * not the SI decimal kilobyte.
 *
 * A route is more than one entry now: `@tanstack/router-plugin`'s
 * `autoCodeSplitting` gives every route component its own chunk, so opening a
 * document costs the application entry, the workspace shell's component, and
 * the document page's component, and each row below measures that whole set
 * with shared files counted once.
 *
 * Only the reading route (`/w/:workspaceSlug/d/:documentId`) has a budget
 * today: quill-plan.md section 31 states one bundle figure, 250 KB gzipped
 * for "the reading route", and reserves the rest of its table for latency
 * and throughput targets (document open time, editor keystroke latency,
 * search query time, ...) that are not bundle sizes and have no place in a
 * bundle-size gate. The workspace home, the editor, presentation mode and the
 * organisation editor are listed as informational rows so a regression there
 * is still visible, but none has a stated byte budget, so none can fail the
 * gate.
 *
 * Wired into `pnpm check` as its last step, after `pnpm build`, so the gate
 * measures the `dist` that build just produced; it blocks in CI like every
 * other step (`docs/operations/bundle-budget.md`).
 *
 * Usage:
 *   node scripts/check-bundle.ts             # requires apps/web/dist already built
 *   node scripts/check-bundle.ts --build      # builds first if dist is missing
 */
import { execSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'node:zlib'

const KB = 1024

interface RouteConfig {
  /** Short name printed in the table; also what a reader would call the route. */
  readonly name: string
  /**
   * The manifest keys to start the graph walk from, measured as one set with
   * shared files counted once. A route is more than one entry now that the
   * router plugin's `autoCodeSplitting` gives every route component its own
   * chunk: opening a document loads the application entry, the workspace
   * shell's component, and the document page's component, and what a reader
   * pays for is all three.
   *
   * A key is either an HTML entry ("index.html") or a route file with the
   * plugin's own split suffix — `<route file>?tsr-split=component` — which is
   * the key the manifest records for a split route component.
   */
  readonly entries: readonly string[]
  /** Gzip byte budget, or `undefined` for an informational row that never fails the gate. */
  readonly budgetBytes: number | undefined
}

/** The manifest key the router plugin gives a route file's split component. */
function routeComponent(routeFile: string): string {
  return `src/routes/${routeFile}?tsr-split=component`
}

/**
 * The one place budgets live (rule 13). Add a row here, not a number
 * scattered through the script, when the plan gains a new bundle figure.
 */
const ROUTES: readonly RouteConfig[] = [
  {
    name: 'reading',
    entries: [
      'index.html',
      // The authentication gate is a layout route with a component of its own
      // (it hosts the search palette), so opening a document loads its chunk
      // too, and a budget that left it out would under-report what a reader
      // actually pays for.
      routeComponent('_authenticated/route.tsx'),
      routeComponent('_authenticated/w/$workspaceSlug/route.tsx'),
      routeComponent('_authenticated/w/$workspaceSlug/d/$documentId/index.tsx'),
    ],
    budgetBytes: 250 * KB,
  },
  {
    name: 'workspace home',
    entries: [
      'index.html',
      routeComponent('_authenticated/route.tsx'),
      routeComponent('_authenticated/w/$workspaceSlug/route.tsx'),
      routeComponent('_authenticated/w/$workspaceSlug/index.tsx'),
    ],
    budgetBytes: undefined,
  },
  {
    name: 'search results',
    entries: [
      'index.html',
      routeComponent('_authenticated/route.tsx'),
      routeComponent('_authenticated/w/$workspaceSlug/route.tsx'),
      routeComponent('_authenticated/w/$workspaceSlug/search.tsx'),
    ],
    budgetBytes: undefined,
  },
  {
    name: 'editor',
    entries: [routeComponent('_authenticated/w/$workspaceSlug/d/$documentId/edit.tsx')],
    budgetBytes: undefined,
  },
  {
    // The external reader's page. Informational like the rows around it —
    // quill-plan.md section 31 states one bundle figure and it is the reading
    // route's — but worth measuring, because this is the surface a stranger
    // with no cache and no account meets first.
    name: 'share link',
    entries: [
      'index.html',
      routeComponent('share/$token/route.tsx'),
      routeComponent('share/$token/index.tsx'),
      // A subtree link's reader loads this one too, and it is the same set of
      // files either way, so the row measures the whole surface.
      routeComponent('share/$token/d/$documentRef/index.tsx'),
    ],
    budgetBytes: undefined,
  },
  {
    name: 'presentation',
    entries: [routeComponent('_authenticated/w/$workspaceSlug_/d/$documentId/present.tsx')],
    budgetBytes: undefined,
  },
  {
    name: 'organisation',
    entries: [routeComponent('_authenticated/admin/organisation.tsx')],
    budgetBytes: undefined,
  },
]

const DEFAULT_DIST_DIR = 'apps/web/dist'
const TOP_FILES_COUNT = 5

interface ManifestChunk {
  readonly file: string
  readonly css?: readonly string[]
  readonly imports?: readonly string[]
  readonly dynamicImports?: readonly string[]
}

type Manifest = Readonly<Record<string, ManifestChunk>>

/** The transitive static (entry + `imports`, never `dynamicImports`) file set reachable from `entryKey`. */
function resolveRouteFiles(
  manifest: Manifest,
  entryKeys: readonly string[],
): { readonly js: readonly string[]; readonly css: readonly string[] } {
  const js = new Set<string>()
  const css = new Set<string>()
  const seen = new Set<string>()
  const queue = [...entryKeys]

  while (queue.length > 0) {
    const key = queue.shift()
    if (key === undefined || seen.has(key)) continue
    seen.add(key)

    const chunk = manifest[key]
    if (!chunk) throw new Error(`manifest has no entry for "${key}"`)

    js.add(chunk.file)
    for (const file of chunk.css ?? []) css.add(file)
    for (const imported of chunk.imports ?? []) queue.push(imported)
    // dynamicImports deliberately not queued: those are separate on-demand chunks.
  }

  return { js: [...js], css: [...css] }
}

interface FileMeasurement {
  readonly path: string
  readonly rawBytes: number
  readonly gzipBytes: number
  readonly brotliBytes: number
}

function measureFile(distDir: string, relPath: string): FileMeasurement {
  const bytes = readFileSync(join(distDir, relPath))
  const gzip = gzipSync(bytes, { level: 9 })
  const brotli = brotliCompressSync(bytes, {
    params: { [zlibConstants.BROTLI_PARAM_QUALITY]: zlibConstants.BROTLI_MAX_QUALITY },
  })
  return {
    path: relPath,
    rawBytes: bytes.length,
    gzipBytes: gzip.length,
    brotliBytes: brotli.length,
  }
}

interface RouteReport {
  readonly name: string
  readonly files: readonly FileMeasurement[]
  readonly rawBytes: number
  readonly gzipBytes: number
  readonly brotliBytes: number
  readonly budgetBytes: number | undefined
  readonly status: 'PASS' | 'FAIL' | 'INFO'
}

function sum(measurements: readonly FileMeasurement[], key: keyof FileMeasurement): number {
  return measurements.reduce((total, measurement) => total + (measurement[key] as number), 0)
}

function statusFor(gzipBytes: number, budgetBytes: number | undefined): RouteReport['status'] {
  if (budgetBytes === undefined) return 'INFO'
  return gzipBytes <= budgetBytes ? 'PASS' : 'FAIL'
}

function measureRoute(distDir: string, manifest: Manifest, route: RouteConfig): RouteReport {
  const { js, css } = resolveRouteFiles(manifest, route.entries)
  const files = [...js, ...css].map((relPath) => measureFile(distDir, relPath))
  const gzipBytes = sum(files, 'gzipBytes')
  return {
    name: route.name,
    files,
    rawBytes: sum(files, 'rawBytes'),
    gzipBytes,
    brotliBytes: sum(files, 'brotliBytes'),
    budgetBytes: route.budgetBytes,
    status: statusFor(gzipBytes, route.budgetBytes),
  }
}

function checkRoutes(
  distDir: string,
  manifest: Manifest,
  routes: readonly RouteConfig[],
): readonly RouteReport[] {
  return routes.map((route) => measureRoute(distDir, manifest, route))
}

function exitCodeFor(reports: readonly RouteReport[]): number {
  return reports.some((report) => report.status === 'FAIL') ? 1 : 0
}

function formatKb(bytes: number): string {
  return `${(bytes / KB).toFixed(1)} KB`
}

function formatBudget(budgetBytes: number | undefined): string {
  return budgetBytes === undefined ? '—' : formatKb(budgetBytes)
}

function padEnd(value: string, width: number): string {
  return value.length >= width ? value : value + ' '.repeat(width - value.length)
}

function padStart(value: string, width: number): string {
  return value.length >= width ? value : ' '.repeat(width - value.length) + value
}

/** Renders the route table as fixed-width columns; no table library pulled in for seven rows. */
function renderTable(reports: readonly RouteReport[]): string {
  const headers = ['Route', 'Files', 'Raw', 'Gzip', 'Brotli', 'Budget', 'Status']
  const rows = reports.map((report) => [
    report.name,
    String(report.files.length),
    formatKb(report.rawBytes),
    formatKb(report.gzipBytes),
    formatKb(report.brotliBytes),
    formatBudget(report.budgetBytes),
    report.status,
  ])
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index]?.length ?? 0)),
  )
  const renderRow = (cells: readonly string[]): string =>
    cells.map((cell, index) => padEnd(cell, widths[index] ?? 0)).join('  ')
  const separator = widths.map((width) => '-'.repeat(width)).join('  ')
  return [renderRow(headers), separator, ...rows.map((row) => renderRow(row))].join('\n')
}

/** The largest files in a route's graph, gzip-largest first, so a regression is diagnosable at a glance. */
function topLargestFiles(
  files: readonly FileMeasurement[],
  count = TOP_FILES_COUNT,
): readonly FileMeasurement[] {
  return files.toSorted((a, b) => b.gzipBytes - a.gzipBytes).slice(0, count)
}

function renderTopFiles(files: readonly FileMeasurement[]): string {
  const widest = Math.max(...files.map((file) => file.path.length))
  return files
    .map(
      (file) =>
        `  ${padEnd(file.path, widest)}  raw ${padStart(formatKb(file.rawBytes), 9)}  gzip ${padStart(formatKb(file.gzipBytes), 9)}`,
    )
    .join('\n')
}

function readManifest(manifestPath: string): Manifest {
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest
}

interface RunResult {
  readonly reports: readonly RouteReport[]
  readonly exitCode: number
}

/** Pure entry point tests drive directly against a temp `distDir`/`manifestPath`, with no build and no CLI. */
function runCheck(
  distDir: string,
  manifestPath: string,
  routes: readonly RouteConfig[] = ROUTES,
): RunResult {
  const manifest = readManifest(manifestPath)
  const reports = checkRoutes(distDir, manifest, routes)
  return { reports, exitCode: exitCodeFor(reports) }
}

function manifestPathFor(distDir: string): string {
  return join(distDir, '.vite', 'manifest.json')
}

function buildWebApp(): void {
  console.log('apps/web/dist is missing a manifest; building @quill/web...')
  execSync('pnpm --filter @quill/web build', { stdio: 'inherit' })
}

function main(): void {
  const args = process.argv.slice(2)
  const shouldBuild = args.includes('--build')
  const distDir = DEFAULT_DIST_DIR
  const manifestPath = manifestPathFor(distDir)

  if (!existsSync(manifestPath)) {
    if (!shouldBuild) {
      console.error(
        `${manifestPath} not found. Run "pnpm --filter @quill/web build" first, or pass --build.`,
      )
      process.exitCode = 1
      return
    }
    buildWebApp()
    if (!existsSync(manifestPath)) {
      console.error(`${manifestPath} still missing after building; is build.manifest enabled?`)
      process.exitCode = 1
      return
    }
  }

  if (!statSync(distDir).isDirectory()) {
    console.error(`${distDir} is not a directory.`)
    process.exitCode = 1
    return
  }

  const { reports, exitCode } = runCheck(distDir, manifestPath)

  console.log(renderTable(reports))

  const reading = reports.find((report) => report.name === 'reading')
  if (reading) {
    console.log(`\nLargest files in the reading route (${relative(process.cwd(), distDir)}):`)
    console.log(renderTopFiles(topLargestFiles(reading.files)))
  }

  if (exitCode !== 0) {
    console.error('\ncheck:bundle: at least one route exceeds its gzip budget.')
  } else {
    console.log('\ncheck:bundle: all budgeted routes are within budget.')
  }

  process.exitCode = exitCode
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) main()

export {
  ROUTES,
  checkRoutes,
  exitCodeFor,
  formatKb,
  measureFile,
  renderTable,
  renderTopFiles,
  resolveRouteFiles,
  runCheck,
  topLargestFiles,
}
export type { FileMeasurement, Manifest, ManifestChunk, RouteConfig, RouteReport }
