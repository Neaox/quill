import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import { generateSourceCorpus, SOURCE_CORPUS_SHAPES } from './source-corpus.ts'

function digest(files: ReadonlyMap<string, string | Uint8Array>): string {
  const hash = createHash('sha256')
  for (const [path, contents] of files) hash.update(path).update('\0').update(contents)
  return hash.digest('hex')
}

function markdownSizes(files: ReadonlyMap<string, string | Uint8Array>): number[] {
  return [...files]
    .flatMap(([path, contents]) =>
      path.endsWith('.md') && typeof contents === 'string' ? [contents.length] : [],
    )
    .toSorted((left, right) => left - right)
}

describe('generateSourceCorpus', () => {
  it('builds L in the shape of lockstay’s documentation', () => {
    const corpus = generateSourceCorpus(SOURCE_CORPUS_SHAPES.L)
    const sizes = markdownSizes(corpus.files)
    expect(sizes).toHaveLength(486)
    expect(corpus.markdownBytes / 1e6).toBeGreaterThan(16)
    expect(corpus.markdownBytes / 1e6).toBeLessThan(20)
    const median = sizes[Math.floor(sizes.length / 2)] ?? 0
    expect(median).toBeGreaterThan(12 * 1024)
    expect(median).toBeLessThan(16 * 1024)
    expect(sizes.at(-1)).toBeLessThanOrEqual(870 * 1024)
    expect([...corpus.files.keys()].filter((path) => path.endsWith('.png'))).toHaveLength(90)
    expect(corpus.files.get(corpus.manifestPath)).toContain(
      '{ slug: c11, path: docs/research/part-11',
    )
  })

  it('links pages to pages that exist, and a few to pages that do not', () => {
    const corpus = generateSourceCorpus(SOURCE_CORPUS_SHAPES.L)
    let links = 0
    let broken = 0
    for (const [path, contents] of corpus.files) {
      if (typeof contents !== 'string' || !path.endsWith('.md')) continue
      for (const [, target] of contents.matchAll(/\]\((\.{1,2}\/[^)#]*\.md)/gu)) {
        links += 1
        const resolved = new URL(target ?? '', `file:///${path}`).pathname.slice(1)
        if (!corpus.files.has(resolved)) broken += 1
      }
    }
    expect(links).toBeGreaterThan(3000)
    expect(links).toBeLessThan(6000)
    expect(broken / links).toBeLessThan(0.06)
    expect(broken).toBeGreaterThan(0)
  })

  it('builds the same bytes from the same seed, and other bytes from another', () => {
    const first = digest(generateSourceCorpus(SOURCE_CORPUS_SHAPES.L).files)
    expect(digest(generateSourceCorpus(SOURCE_CORPUS_SHAPES.L).files)).toBe(first)
    expect(digest(generateSourceCorpus(SOURCE_CORPUS_SHAPES.L, 63).files)).not.toBe(first)
  })

  it('builds XL as 5,000 smaller pages', () => {
    const corpus = generateSourceCorpus(SOURCE_CORPUS_SHAPES.XL)
    const sizes = markdownSizes(corpus.files)
    expect(sizes).toHaveLength(5000)
    expect(corpus.markdownBytes / 1e6).toBeGreaterThan(36)
    expect(corpus.markdownBytes / 1e6).toBeLessThan(46)
    expect(sizes.at(-1)).toBeLessThanOrEqual(400 * 1024)
  })
})
