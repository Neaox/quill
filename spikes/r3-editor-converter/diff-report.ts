// Prints the line-level differences between each corpus document and its
// round trip, so the normalisations can be catalogued.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseMarkdown, stringifyMdast } from './src/pipeline.ts'
import { mdastToProseMirror } from './src/mdast-to-pm.ts'
import { proseMirrorToMdast } from './src/pm-to-mdast.ts'

const CORPUS = join(import.meta.dirname, 'corpus')

for (const file of readdirSync(CORPUS)
  .filter((f) => f.endsWith('.md'))
  .sort()) {
  const md0 = readFileSync(join(CORPUS, file), 'utf8').replace(/\r\n/g, '\n')
  const { doc } = mdastToProseMirror(parseMarkdown(md0))
  const md2 = stringifyMdast(proseMirrorToMdast(doc).tree)
  if (md2 === md0) continue

  const a = md0.split('\n')
  const b = md2.split('\n')
  console.log(`\n===== ${file} =====`)
  // Crude alignment: walk both, printing runs that differ.
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (a[i] === b[j]) {
      i += 1
      j += 1
      continue
    }
    // Try to resynchronise within a small window.
    let resync = -1
    for (let k = 1; k <= 6 && resync < 0; k += 1) {
      if (a[i + k] !== undefined && a[i + k] === b[j] && a[i + k] !== '') resync = k
    }
    let resyncB = -1
    for (let k = 1; k <= 6 && resyncB < 0; k += 1) {
      if (b[j + k] !== undefined && b[j + k] === a[i] && b[j + k] !== '') resyncB = k
    }
    if (resync > 0 && (resyncB < 0 || resync <= resyncB)) {
      for (let k = 0; k < resync; k += 1) console.log(`- ${JSON.stringify(a[i + k])}`)
      i += resync
      continue
    }
    if (resyncB > 0) {
      for (let k = 0; k < resyncB; k += 1) console.log(`+ ${JSON.stringify(b[j + k])}`)
      j += resyncB
      continue
    }
    if (a[i] !== undefined) console.log(`- ${JSON.stringify(a[i])}`)
    if (b[j] !== undefined) console.log(`+ ${JSON.stringify(b[j])}`)
    i += 1
    j += 1
  }
}
