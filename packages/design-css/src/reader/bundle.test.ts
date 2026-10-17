import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

import { describe, expect, it } from 'vitest'

import { bundleReaderScript, READER_SCRIPT_FILE, REGENERATE_READER } from './bundle.ts'

/**
 * The reader is enhancement on every public page view; it stays well under
 * this. Four enhancers share it — highlighting, the full-screen viewer (the
 * diagram lightbox and the table viewer share one), tables, and code blocks
 * (copy buttons and code-group tabs, ADR-041) — at roughly 2.5 to 4 KiB
 * gzipped each. Tables carry the most (ADR-040: sorting, the hanging header
 * and footer, the pinned scrollbar, the viewer and its CSV and Markdown
 * copies). Animated images playing briefly (ADR-047) add about a KiB,
 * so the budget is 15 KiB.
 */
const GZIPPED_BUDGET_BYTES = 15 * 1024

const generated = readFileSync(fileURLToPath(new URL(READER_SCRIPT_FILE, import.meta.url)), 'utf8')

describe('the public reader script', () => {
  it('is its sources bundled, as last generated', async () => {
    expect(generated).toBe(await bundleReaderScript())
  })

  it('names the command that regenerates it, and enhances the page it is loaded into', () => {
    expect(generated.split('\n')[0]).toContain(REGENERATE_READER)
    expect(generated).toContain('(window)')
    // An ES module with nothing to import: the public site serves one file.
    expect(generated).not.toMatch(/\bimport\s*[{(*'"`]|\brequire\(/u)
  })

  it('ships the range-painting client and no Prism grammar, within its budget', () => {
    expect(generated).not.toMatch(/prism|languages\.extend|insertBefore/iu)
    expect(gzipSync(generated).byteLength).toBeLessThan(GZIPPED_BUDGET_BYTES)
  })
})
