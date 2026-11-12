import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { rolldown, type Plugin } from 'rolldown'

import {
  BUILT_DOCUMENT_WORKER,
  DOCUMENT_WORKER_SOURCE,
  sourcesDigest,
  workerManifest,
} from './document-work-pool.ts'

/**
 * The document work pool's thread as one built JavaScript module (ADR-062,
 * step 3). A thread started from the TypeScript source loads and strips
 * several hundred modules (about 2.7 seconds a thread on a development
 * machine); the built module is one file, so a thread is ready in a
 * fraction of that, and its CPU time is spent on documents.
 *
 * `pnpm --filter @quill/server build` writes it to `@quill/format`'s `dist/`;
 * the pool loads it from there when it exists, and the source otherwise
 * (development, tests). Only the build entry (`@quill/format/build`) imports
 * this module: it is the one that needs the bundler.
 */

const ENTRY = '\0document-work-entry'
const PRISM_FIRST = '\0document-work-prism-first'

/**
 * Prism's grammars are CommonJS modules that reach for the core through a
 * global. Run from the source, the core has set that global before any
 * grammar loads; in one module the bundler may evaluate a grammar first, so
 * the entry registers the core before it imports the thread itself.
 */
const entry: Plugin = {
  name: 'document-work-entry',
  resolveId: (id) => (id === ENTRY || id === PRISM_FIRST ? id : null),
  load: (id) => {
    if (id === PRISM_FIRST) return "import Prism from 'prismjs'\nglobalThis.Prism = Prism\n"
    if (id === ENTRY) {
      const source = JSON.stringify(fileURLToPath(DOCUMENT_WORKER_SOURCE))
      return `import ${JSON.stringify(PRISM_FIRST)}\nimport ${source}\n`
    }
    return null
  },
}

/** Builds the thread's module and writes it to `file`. */
export async function buildDocumentWorker(file: URL = BUILT_DOCUMENT_WORKER): Promise<void> {
  const bundle = await rolldown({
    input: ENTRY,
    platform: 'node',
    // Resolved from the highlighter's package, where `prismjs` is a dependency.
    cwd: fileURLToPath(new URL('../../highlight/', import.meta.url)),
    plugins: [entry],
  })
  try {
    const { output } = await bundle.write({
      file: fileURLToPath(file),
      format: 'esm',
      minify: true,
      codeSplitting: false,
    })
    // Every file the module was built from, so the pool can tell a module
    // built from these sources from one left behind by an older build.
    // One file, so one chunk: the module itself.
    const [chunk] = output
    const sources = chunk.moduleIds.filter((id) => !id.startsWith('\0')).toSorted()
    writeFileSync(
      workerManifest(file),
      `${JSON.stringify({ sources, digest: sourcesDigest(sources) }, null, 2)}
`,
    )
  } finally {
    await bundle.close()
  }
}
