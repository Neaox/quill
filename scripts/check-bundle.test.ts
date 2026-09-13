import { randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import {
  checkRoutes,
  exitCodeFor,
  formatKb,
  measureFile,
  resolveRouteFiles,
  runCheck,
  topLargestFiles,
} from './check-bundle.ts'
import type { Manifest, RouteConfig } from './check-bundle.ts'

function withTempDist(run: (distDir: string) => void): void {
  const distDir = mkdtempSync(join(tmpdir(), 'quill-check-bundle-'))
  try {
    run(distDir)
  } finally {
    rmSync(distDir, { recursive: true, force: true })
  }
}

/** Writes a file of `bytes` bytes of repeated content under `distDir/assets/<name>`, returning its manifest-relative path. */
function writeAsset(distDir: string, name: string, bytes: number): string {
  const relPath = join('assets', name)
  mkdirSync(join(distDir, 'assets'), { recursive: true })
  writeFileSync(join(distDir, relPath), 'x'.repeat(bytes))
  return relPath.replaceAll('\\', '/')
}

function writeManifest(distDir: string, manifest: Manifest): string {
  mkdirSync(join(distDir, '.vite'), { recursive: true })
  const manifestPath = join(distDir, '.vite', 'manifest.json')
  writeFileSync(manifestPath, JSON.stringify(manifest))
  return manifestPath
}

describe('resolveRouteFiles', () => {
  it('follows static imports transitively and attaches css from every visited chunk', () => {
    const manifest: Manifest = {
      'index.html': {
        file: 'assets/index.js',
        css: ['assets/index.css'],
        imports: ['shared.js'],
        dynamicImports: ['editor.tsx'],
      },
      'shared.js': {
        file: 'assets/shared.js',
        css: ['assets/shared.css'],
        imports: ['vendor.js'],
      },
      'vendor.js': { file: 'assets/vendor.js' },
      'editor.tsx': { file: 'assets/editor.js' },
    }

    const { js, css } = resolveRouteFiles(manifest, ['index.html'])

    expect(js).toEqual(['assets/index.js', 'assets/shared.js', 'assets/vendor.js'])
    expect(css).toEqual(['assets/index.css', 'assets/shared.css'])
  })

  it('excludes a dynamic-import-only chunk from the graph', () => {
    const manifest: Manifest = {
      'index.html': {
        file: 'assets/index.js',
        dynamicImports: ['editor.tsx'],
      },
      'editor.tsx': { file: 'assets/editor.js', imports: ['editor-only.js'] },
      'editor-only.js': { file: 'assets/editor-only.js' },
    }

    const { js } = resolveRouteFiles(manifest, ['index.html'])

    expect(js).toEqual(['assets/index.js'])
  })

  it('resolves a dynamic entry as its own route root, including what it statically imports', () => {
    const manifest: Manifest = {
      'index.html': { file: 'assets/index.js' },
      'editor.tsx': {
        file: 'assets/editor.js',
        // Mirrors the real app: a lazy route chunk statically imports the
        // entry chunk it shares runtime code with.
        imports: ['index.html'],
      },
    }

    const { js } = resolveRouteFiles(manifest, ['editor.tsx'])

    expect(js).toEqual(['assets/editor.js', 'assets/index.js'])
  })

  it('does not loop forever on a cycle', () => {
    const manifest: Manifest = {
      a: { file: 'assets/a.js', imports: ['b'] },
      b: { file: 'assets/b.js', imports: ['a'] },
    }

    const { js } = resolveRouteFiles(manifest, ['a'])

    expect(js).toEqual(['assets/a.js', 'assets/b.js'])
  })

  it('throws when the manifest has no entry for the requested key', () => {
    expect(() => resolveRouteFiles({}, ['missing.js'])).toThrow(/no entry for "missing.js"/)
  })
})

describe('measureFile', () => {
  it('measures raw, gzip, and brotli sizes for a real file', () => {
    withTempDist((distDir) => {
      const content = 'a'.repeat(10_000)
      const relPath = writeAsset(distDir, 'repeat.js', 0)
      writeFileSync(join(distDir, relPath), content)

      const measurement = measureFile(distDir, relPath)

      expect(measurement.rawBytes).toBe(10_000)
      expect(measurement.gzipBytes).toBe(gzipSync(content, { level: 9 }).length)
      // Highly repetitive content compresses to a tiny fraction of its raw size.
      expect(measurement.gzipBytes).toBeLessThan(measurement.rawBytes / 10)
      expect(measurement.brotliBytes).toBeGreaterThan(0)
      expect(measurement.brotliBytes).toBeLessThan(measurement.rawBytes / 10)
    })
  })
})

describe('checkRoutes / exitCodeFor', () => {
  const routes: readonly RouteConfig[] = [
    { name: 'reading', entries: ['index.html'], budgetBytes: 1_000 },
    { name: 'editor', entries: ['editor.tsx'], budgetBytes: undefined },
  ]

  it('passes a route whose gzip size is within budget', () => {
    withTempDist((distDir) => {
      const entryFile = writeAsset(distDir, 'index.js', 100)
      const editorFile = writeAsset(distDir, 'editor.js', 100)
      const manifest: Manifest = {
        'index.html': { file: entryFile },
        'editor.tsx': { file: editorFile },
      }

      const reports = checkRoutes(distDir, manifest, routes)

      const reading = reports.find((report) => report.name === 'reading')
      expect(reading?.status).toBe('PASS')
      expect(exitCodeFor(reports)).toBe(0)
    })
  })

  it('fails a route whose gzip size exceeds its budget and exits non-zero', () => {
    withTempDist((distDir) => {
      // Random bytes barely shrink under gzip, so this comfortably exceeds a 1,000-byte budget.
      const big = randomBytes(5_000)
      const entryFile = writeAsset(distDir, 'index.js', 0)
      writeFileSync(join(distDir, entryFile), big)
      const manifest: Manifest = { 'index.html': { file: entryFile } }

      const reports = checkRoutes(distDir, manifest, [routes[0] as RouteConfig])

      expect(reports[0]?.status).toBe('FAIL')
      expect(exitCodeFor(reports)).toBe(1)
    })
  })

  it('marks a route with no budget as informational and never fails it', () => {
    withTempDist((distDir) => {
      const big = randomBytes(50_000)
      const entryFile = writeAsset(distDir, 'editor.js', 0)
      writeFileSync(join(distDir, entryFile), big)
      const manifest: Manifest = { 'editor.tsx': { file: entryFile } }

      const reports = checkRoutes(distDir, manifest, [routes[1] as RouteConfig])

      expect(reports[0]?.status).toBe('INFO')
      expect(exitCodeFor(reports)).toBe(0)
    })
  })
})

describe('topLargestFiles', () => {
  it('returns the largest files by gzip size, largest first, capped at the requested count', () => {
    const files = [
      { path: 'a', rawBytes: 1, gzipBytes: 10, brotliBytes: 5 },
      { path: 'b', rawBytes: 1, gzipBytes: 30, brotliBytes: 5 },
      { path: 'c', rawBytes: 1, gzipBytes: 20, brotliBytes: 5 },
    ]

    expect(topLargestFiles(files, 2).map((file) => file.path)).toEqual(['b', 'c'])
  })
})

describe('formatKb', () => {
  it('renders bytes as kilobytes (1024 bytes) to one decimal place', () => {
    expect(formatKb(1024)).toBe('1.0 KB')
    expect(formatKb(256 * 1024)).toBe('256.0 KB')
  })
})

describe('runCheck', () => {
  it('reads a manifest from disk and reports a route graph end to end', () => {
    withTempDist((distDir) => {
      const entryFile = writeAsset(distDir, 'index.js', 100)
      const cssFile = writeAsset(distDir, 'index.css', 50)
      const manifest: Manifest = {
        'index.html': { file: entryFile, css: [cssFile] },
      }
      const manifestPath = writeManifest(distDir, manifest)
      const routes: readonly RouteConfig[] = [
        { name: 'reading', entries: ['index.html'], budgetBytes: 1_000 },
      ]

      const { reports, exitCode } = runCheck(distDir, manifestPath, routes)

      expect(exitCode).toBe(0)
      expect(reports[0]?.files).toHaveLength(2)
      expect(reports[0]?.rawBytes).toBe(150)
    })
  })
})
