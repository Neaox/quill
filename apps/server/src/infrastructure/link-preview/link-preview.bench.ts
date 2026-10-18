import { spawn } from 'node:child_process'
import { performance } from 'node:perf_hooks'

import { parseMarkdown, renderHtml, scanLinkSlots } from '@quill/markdown'
import type { LinkPreviewView } from '@quill/domain'
import sharp from 'sharp'

import { createIsolatedTranscoder } from './isolated-transcoder.ts'
import { THUMBNAIL_SPEC } from './image-transcoder.ts'
import { extractPageMetadata, headMarkup } from './page-metadata.ts'

/**
 * The link preview hot paths, measured against budgets (quill-plan.md §31:
 * "hot paths get a benchmark next to their tests").
 *
 * ```
 * pnpm --filter @quill/server bench:link-preview
 * ```
 *
 * Each line prints the time of one operation and the budget it must stay under;
 * the process exits non-zero if any is over, so it can gate a change that
 * touches these paths. The budgets are generous multiples of what was measured
 * when they were set (2026-10), so a failure is a real regression and not noise:
 *
 * - **Reading a page of links** is on the way to every document open. The page
 *   budget is 200 ms to content when cached (§31), and finding and filling
 *   fifty links in a 225 KB body is a small slice of it. Parsing the body to do
 *   it cost 100 ms each way, which is why it no longer does.
 * - **Reading a stranger's page** runs on the one thread that serves requests,
 *   so it must be small whatever the page is (`headMarkup` exists because a
 *   nesting attack made it 47 seconds).
 * - **Decoding an image** is warm in a pooled worker; the cold start is paid
 *   once per worker, not per image.
 */

const say = (line: string) => process.stdout.write(`${line}\n`)
let failed = false

function check(label: string, budgetMs: number, measuredMs: number): void {
  const over = measuredMs > budgetMs
  if (over) failed = true
  say(
    `${over ? 'OVER ' : 'ok   '} ${label.padEnd(52)} ${measuredMs.toFixed(1).padStart(8)} ms   budget ${String(budgetMs).padStart(5)} ms`,
  )
}

function time(label: string, budgetMs: number, runs: number, work: () => unknown): void {
  work()
  const started = performance.now()
  for (let i = 0; i < runs; i += 1) work()
  check(label, budgetMs, (performance.now() - started) / runs)
}

// A big page: 300 tags of head, then body filler up to about 450 KB.
const head = `<head><title>T</title>${'<meta name="x" content="y"><link rel="preload" href="/a.js">'.repeat(150)}</head>`
const page = `${head}<body>${'<div class="a"><p>some text</p></div>'.repeat(12_000)}`
time('headMarkup, a 450 KB page', 5, 20, () => headMarkup(page))
time('extractPageMetadata, a 450 KB page', 20, 20, () =>
  extractPageMetadata(page, 'https://x.example/'),
)
time('extractPageMetadata, nested 100 000 deep', 50, 3, () =>
  extractPageMetadata(
    `<head><title>T</title></head><body>${'<div>'.repeat(100_000)}`,
    'https://x.example/',
  ),
)

// A reading body: 1 500 paragraphs, fifty of them with a link directive.
const markdown = Array.from({ length: 1500 }, (_, i) =>
  i % 30 === 0
    ? `See :link[https://site${i}.example/page]{display=inline} for more.`
    : `Paragraph ${i} with **bold**, \`code\` and a [link](https://ordinary.example/${i}).`,
).join('\n\n')
const body = renderHtml(parseMarkdown(markdown))
const slots = scanLinkSlots(body)
say(`body: ${(body.length / 1024).toFixed(0)} KB, ${slots.keys.length} slots`)
const views = new Map<string, LinkPreviewView>(
  slots.keys.map((key) => [
    key,
    {
      state: 'ready',
      stale: false,
      preview: {
        url: key,
        canonicalUrl: key,
        title: 'A title',
        description: 'A description',
        siteName: 'Site',
        kind: 'article',
        thumbnail: null,
        favicon: { hash: 'a'.repeat(64), width: 64, height: 64, mediaType: 'image/webp' },
        layer: 'open-graph',
        fetchedAt: '2026-10-13T09:00:00.000Z',
      },
    },
  ]),
)
const fillOptions = {
  defaultDisplay: 'inline',
  imageUrl: (image: { hash: string }) => `/link-previews/images/${image.hash}`,
} as const
time('scanLinkSlots, finding 50 slots in 225 KB', 40, 20, () => scanLinkSlots(body))
time('scan and fill 50 slots in 225 KB', 60, 20, () => scanLinkSlots(body).draw(views, fillOptions))
time('fill a body with no slots', 2, 200, () =>
  scanLinkSlots('<p>no slots</p>'.repeat(20_000)).draw(views, fillOptions),
)

// Decoding an image in a pooled worker.
const png = new Uint8Array(
  await sharp({ create: { width: 1200, height: 630, channels: 3, background: '#c33' } })
    .png()
    .toBuffer(),
)
const transcoder = createIsolatedTranscoder()
await transcoder.transcode(png, THUMBNAIL_SPEC)
const decodeStarted = performance.now()
for (let i = 0; i < 10; i += 1) await transcoder.transcode(png, THUMBNAIL_SPEC)
check('decode a 1200x630 image, warm worker', 150, (performance.now() - decodeStarted) / 10)
const burstStarted = performance.now()
await Promise.all(Array.from({ length: 8 }, () => transcoder.transcode(png, THUMBNAIL_SPEC)))
check('decode 8 images at once through the pool', 1500, performance.now() - burstStarted)
transcoder.close()

// What a worker costs in memory: each is a whole process.
const child = spawn(
  process.execPath,
  [
    '--input-type=module',
    '-e',
    "import sharp from 'sharp'; await sharp({create:{width:1200,height:630,channels:3,background:'#c33'}}).png().toBuffer(); process.stdout.write(String(process.memoryUsage().rss))",
  ],
  { cwd: new URL('../../..', import.meta.url) },
)
let output = ''
child.stdout.on('data', (chunk) => {
  output += String(chunk)
})
await new Promise((done) => child.on('exit', done))
const megabytes = Number(output) / 1024 / 1024
say(
  `one image worker's resident memory: ${megabytes.toFixed(0)} MiB (pool of 2: ${(megabytes * 2).toFixed(0)} MiB)`,
)

process.exit(failed ? 1 : 0)
