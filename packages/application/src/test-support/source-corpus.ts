import { BRAND } from '@quill/brand'

import { pngFile } from './image-fixtures.ts'

/**
 * The generated repositories ADR-062's budgets are measured on, built from a
 * seed so every run, on every machine, measures the same bytes.
 *
 * - **L** is shaped like a real documentation repository: about 500
 *   Markdown files whose sizes follow a log-normal (median about 14 KB,
 *   95th percentile about 150 KB, none over 900 KB, about 18 MB in all), in
 *   12 collections of nested folders with a README in most, about 4,000
 *   relative links between them, and 90 pictures.
 * - **XL** is a large handbook: 5,000 smaller files (median 6 KB, about
 *   40 MB), 40 collections and 500 pictures.
 *
 * The pages mix what real documentation holds, in about the proportions
 * a real repository's do: headings, paragraphs with emphasis, links and inline code,
 * nested lists, task lists, tables, code in several languages, block quotes,
 * callouts, details, component blocks, pictures, and front matter. What a
 * corpus is *for* is the parser's cost, so it holds every construct the
 * parser has an extension for.
 */

export interface SourceCorpusShape {
  readonly name: 'L' | 'XL'
  readonly documents: number
  readonly collections: number
  readonly assets: number
  /** Bytes of the median page. */
  readonly median: number
  /** How widely page sizes spread: the log-normal's sigma. */
  readonly spread: number
  /** No page is larger. */
  readonly largest: number
}

export const SOURCE_CORPUS_SHAPES = {
  L: {
    name: 'L',
    documents: 500,
    collections: 12,
    assets: 90,
    median: 14 * 1024,
    // ln(150 KB / 14 KB) / 1.645: a 95th percentile of 150 KB over the median.
    spread: 1.44,
    largest: 900 * 1024,
  },
  XL: {
    name: 'XL',
    documents: 5000,
    collections: 40,
    assets: 500,
    median: 6 * 1024,
    // sqrt(2 ln(8 KB / 6 KB)): a mean page of 8 KB, so 40 MB in all.
    spread: 0.76,
    largest: 400 * 1024,
  },
} as const satisfies Readonly<Record<string, SourceCorpusShape>>

export interface SourceCorpus {
  readonly shape: SourceCorpusShape
  /** Every file of the repository, by path: Markdown as text, pictures as bytes. */
  readonly files: ReadonlyMap<string, string | Uint8Array>
  /** The manifest, at `.quill/workspace.yaml`, naming the collections. */
  readonly manifestPath: string
  /** Bytes of Markdown in all. */
  readonly markdownBytes: number
}

/** A small, fast, seeded generator (mulberry32): the same numbers on every platform. */
function random(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let mixed = state
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1)
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }
}

const WORDS = [
  'archive',
  'lending',
  'catalog',
  'shelving',
  'atlas',
  'donor',
  'journal',
  'volume',
  'register',
  'conservation',
  'loan',
  'policy',
  'sync',
  'webhook',
  'request',
  'response',
  'record',
  'wing',
  'illustration',
  'staff',
  'review',
  'decision',
  'migration',
  'schema',
  'deploy',
  'rollback',
  'the',
  'a',
  'of',
  'and',
  'to',
  'in',
  'is',
  'for',
  'when',
  'with',
  'each',
  'every',
  'its',
  'before',
  'after',
  'once',
  'never',
  'always',
  'reads',
  'writes',
  'keeps',
  'sends',
  'holds',
]
const LANGUAGES = ['ts', 'bash', 'json', 'yaml', 'sql', 'tsx', 'diff'] as const

/** The collections' directories: nested, as a real repository's are. */
function collectionPaths(count: number): readonly string[] {
  const roots = ['rules', 'floors', 'log', 'holdings', 'exhibits', 'letters', 'facilities', 'api']
  return Array.from({ length: count }, (_, index) => {
    /* v8 ignore next -- an index modulo the length is always in range. */
    const root = roots[index % roots.length] ?? 'docs'
    return index < roots.length ? `docs/${root}` : `docs/${root}/part-${index}`
  })
}

/** A link from one repository file to another, as a writer types it. */
function relative(from: string, to: string): string {
  const source = from.split('/').slice(0, -1)
  const target = to.split('/')
  let shared = 0
  while (shared < source.length && source[shared] === target[shared]) shared += 1
  const up = source.length - shared
  return `${up === 0 ? './' : '../'.repeat(up)}${target.slice(shared).join('/')}`
}

/**
 * The repository of a shape, from a seed. Paths and sizes are decided
 * first, so every page can link to pages that exist (and a few that do
 * not, as real repositories do).
 */
export function generateSourceCorpus(shape: SourceCorpusShape, seed = 62): SourceCorpus {
  const next = random(seed)
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T
  const normal = (): number => {
    // Box–Muller, from two uniform draws.
    const u = Math.max(next(), 1e-12)
    const v = next()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }

  const collections = collectionPaths(shape.collections)
  const assets = Array.from(
    { length: shape.assets },
    (_, index) => `docs/assets/figure-${String(index).padStart(4, '0')}.png`,
  )
  const taken = new Set<string>()
  const pages = Array.from({ length: shape.documents }, (_, index) => {
    /* v8 ignore next -- as above. */
    const collection = collections[index % collections.length] ?? 'docs'
    const depth = Math.floor(next() * 3)
    const folders = Array.from({ length: depth }, () => pick(WORDS.slice(0, 26)))
    const directory = [collection, ...folders].join('/')
    const readme = next() < 0.25 && !taken.has(`${directory}/README.md`)
    const name = readme ? 'README.md' : `${pick(WORDS.slice(0, 26))}-${index}.md`
    taken.add(`${directory}/${name}`)
    const size = Math.min(
      shape.largest,
      Math.max(600, Math.round(shape.median * Math.exp(shape.spread * normal()))),
    )
    return { path: `${directory}/${name}`, size }
  })
  const paths = pages.map(({ path }) => path)

  const sentence = (from: string): string => {
    const words = Array.from({ length: 8 + Math.floor(next() * 14) }, () => pick(WORDS))
    const roll = next()
    if (roll < 0.03) {
      const target =
        next() < 0.97 ? pick(paths) : `${from.split('/').slice(0, -1).join('/')}/gone.md`
      const anchor = next() < 0.3 ? `#${pick(WORDS)}` : ''
      words.splice(3, 0, `[${pick(WORDS)} ${pick(WORDS)}](${relative(from, target)}${anchor})`)
    } else if (roll < 0.15) {
      words.splice(2, 0, `\`${pick(WORDS)}.${pick(WORDS)}()\``)
    } else if (roll < 0.25) {
      words.splice(4, 0, `**${pick(WORDS)} ${pick(WORDS)}**`)
    } else if (roll < 0.31) {
      words.splice(1, 0, `_${pick(WORDS)}_`)
    } else if (roll < 0.35) {
      words.splice(5, 0, `https://example.com/${pick(WORDS)}`)
    }
    const text = words.join(' ')
    return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`
  }
  const paragraph = (from: string): string =>
    Array.from({ length: 2 + Math.floor(next() * 4) }, () => sentence(from)).join(' ')

  const block = (from: string): string => {
    const roll = next()
    if (roll < 0.36) return paragraph(from)
    if (roll < 0.48) {
      return Array.from({ length: 3 + Math.floor(next() * 5) }, (_, index) =>
        index > 0 && next() < 0.3 ? `  - ${sentence(from)}` : `- ${sentence(from)}`,
      ).join('\n')
    }
    if (roll < 0.53) {
      return Array.from(
        { length: 3 + Math.floor(next() * 4) },
        (_, index) => `${index + 1}. ${sentence(from)}`,
      ).join('\n')
    }
    if (roll < 0.56) {
      return Array.from(
        { length: 3 },
        () => `- [${next() < 0.5 ? 'x' : ' '}] ${sentence(from)}`,
      ).join('\n')
    }
    if (roll < 0.65) {
      const columns = 3 + Math.floor(next() * 3)
      const header = Array.from({ length: columns }, () => pick(WORDS))
      const rows = Array.from({ length: 3 + Math.floor(next() * 8) }, () =>
        Array.from({ length: columns }, () => `${pick(WORDS)} ${pick(WORDS)}`),
      )
      return [
        `| ${header.join(' | ')} |`,
        `| ${header.map(() => '---').join(' | ')} |`,
        ...rows.map((row) => `| ${row.join(' | ')} |`),
      ].join('\n')
    }
    if (roll < 0.76) {
      const language = pick(LANGUAGES)
      const lines = Array.from(
        { length: 4 + Math.floor(next() * 16) },
        (_, index) =>
          `const ${pick(WORDS)}${index} = ${JSON.stringify(pick(WORDS))} // ${pick(WORDS)}`,
      )
      return `\`\`\`${language}\n${lines.join('\n')}\n\`\`\``
    }
    if (roll < 0.8) return `> ${paragraph(from)}`
    if (roll < 0.84) return `:::${pick(['note', 'tip', 'warning'])}\n${paragraph(from)}\n:::`
    if (roll < 0.87) return `:::details[${sentence(from)}]\n${paragraph(from)}\n:::`
    if (roll < 0.9) {
      return `:::endpoint{method=${pick(['GET', 'POST', 'PUT'])} path=/${pick(WORDS)}/${pick(WORDS)}}\n${sentence(from)}\n:::`
    }
    if (roll < 0.94) return `![${pick(WORDS)}](${relative(from, pick(assets))})`
    return `## ${pick(WORDS)} ${pick(WORDS)}\n\n${paragraph(from)}`
  }

  const files = new Map<string, string | Uint8Array>()
  let markdownBytes = 0
  for (const { path, size } of pages) {
    const parts = [
      next() < 0.3
        ? `---\norder: ${1 + Math.floor(next() * 20)}\nstatus: ${pick(['draft', 'accepted'])}\n---\n`
        : '',
      `# ${pick(WORDS)} ${pick(WORDS)}\n`,
    ]
    let length = parts.join('\n').length
    while (length < size) {
      const written = next() < 0.12 ? `## ${pick(WORDS)} ${pick(WORDS)}` : block(path)
      parts.push(written)
      length += written.length + 2
    }
    const text = `${parts.join('\n\n')}\n`
    markdownBytes += text.length
    files.set(path, text)
  }
  for (const [index, path] of assets.entries()) {
    files.set(path, pngFile({ width: 1 + (index % 7), height: 1 + (index % 5) }))
  }
  const manifestPath = `.${BRAND.slug}/workspace.yaml`
  files.set(
    manifestPath,
    [
      'version: 1',
      'collections:',
      ...collections.map(
        (path, index) => `  - { slug: c${index}, path: ${path}, title: Collection ${index} }`,
      ),
      'assets: [docs/assets/**]',
      '',
    ].join('\n'),
  )
  return { shape, files, manifestPath, markdownBytes }
}
