// R3 fidelity harness.
//
// For every corpus document it measures four things:
//
//   md1 = stringify(parse(md0))                        remark's own canonical form
//   md2 = stringify(pm2mdast(mdast2pm(parse(md0))))    the full editor round trip
//   md3 = stringify(pm2mdast(mdast2pm(parse(md2))))    the second pass
//
//   byte  md2 === md0            nothing at all changed
//   conv  md2 === md1            the ProseMirror hop added no loss of its own,
//                                so every difference from md0 is remark's
//                                canonical normalisation, not the editor's
//   sem   parse(md2) == parse(md0)  same mdast after re-parse
//   idem  md3 === md2            ADR-002's determinism requirement
//
// Flags:
//   --layout-attr     lift ":::wide"/":::full" onto a `layout` attr and lower
//                     it again (the ADR-027 editor representation)
//   --collapse-soft-breaks   model a live editor, which turns a source wrap
//                     inside a paragraph into a space
//   --verbose         print the before/after of any document that is not
//                     semantically identical
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseMarkdown, stringifyMdast } from './src/pipeline.ts'
import { mdastToProseMirror, options as convertOptions } from './src/mdast-to-pm.ts'
import { proseMirrorToMdast } from './src/pm-to-mdast.ts'
import { liftLayout, lowerLayout } from './src/layout.ts'
import { firstDiffs, mdastEqual, normaliseMdast } from './src/compare.ts'
import { schema } from './src/schema.ts'

const CORPUS = join(import.meta.dirname, 'corpus')
const layoutMode = process.argv.includes('--layout-attr') ? 'attr' : 'wrapper'
const verbose = process.argv.includes('--verbose')
if (process.argv.includes('--collapse-soft-breaks')) convertOptions.softBreaks = 'collapse'

function roundTrip(md: string) {
  const tree = parseMarkdown(md)
  const forward = mdastToProseMirror(tree)
  const doc = layoutMode === 'attr' ? lowerLayout(liftLayout(forward.doc)) : forward.doc
  const back = proseMirrorToMdast(doc)
  return {
    tree,
    doc: forward.doc,
    lifted: layoutMode === 'attr' ? liftLayout(forward.doc) : forward.doc,
    out: stringifyMdast(back.tree),
    warnings: [...forward.warnings, ...back.warnings],
  }
}

type Row = {
  file: string
  bytes: number
  byte: boolean
  conv: boolean
  sem: boolean
  idem: boolean
  notes: string
}

const rows: Row[] = []
const files = readdirSync(CORPUS)
  .filter((f) => f.endsWith('.md'))
  .sort()
const trips = new Map<string, ReturnType<typeof roundTrip>>()

for (const file of files) {
  const md0 = readFileSync(join(CORPUS, file), 'utf8').replace(/\r\n/g, '\n')
  const md1 = stringifyMdast(parseMarkdown(md0))
  const first = roundTrip(md0)
  trips.set(file, first)
  const md2 = first.out
  const md3 = roundTrip(md2).out

  const sem = mdastEqual(parseMarkdown(md0), parseMarkdown(md2))
  const notes: string[] = []
  for (const w of first.warnings) notes.push(`${w.code}:${w.detail}`)
  if (!sem) {
    for (const d of firstDiffs(parseMarkdown(md0), parseMarkdown(md2), 2)) {
      notes.push(`${d.path}: ${d.left.slice(0, 40)} -> ${d.right.slice(0, 40)}`)
    }
  }

  rows.push({
    file,
    bytes: md0.length,
    byte: md2 === md0,
    conv: md2 === md1,
    sem,
    idem: md3 === md2,
    notes: [...new Set(notes)].slice(0, 2).join(' | '),
  })

  if (verbose && !sem) {
    console.log(`\n===== ${file} =====\n--- original ---\n${md0}\n--- round trip ---\n${md2}\n`)
  }
}

const tick = (b: boolean) => (b ? 'yes' : 'NO ')
const w = Math.max(...rows.map((r) => r.file.length))

console.log(
  `\nR3 round-trip fidelity  (layout: ${layoutMode}, soft breaks: ${convertOptions.softBreaks})\n`,
)
console.log(`${'document'.padEnd(w)} | bytes | byte | conv | sem | idem | notes`)
console.log(`${'-'.repeat(w)} | ----- | ---- | ---- | --- | ---- | -----`)
for (const r of rows) {
  console.log(
    `${r.file.padEnd(w)} | ${String(r.bytes).padStart(5)} | ${tick(r.byte)}  | ${tick(r.conv)}  | ` +
      `${tick(r.sem)} | ${tick(r.idem)}  | ${r.notes}`,
  )
}

const count = (key: keyof Row) => rows.filter((r) => r[key] === true).length
console.log(
  `\n${rows.length} documents: ${count('byte')} byte-identical, ${count('conv')} converter-lossless ` +
    `(md2 === md1), ${count('sem')} semantically identical, ${count('idem')} idempotent.`,
)

// --- Q3: unknown-node preservation, checked explicitly --------------------

console.log('\nUnknown-node preservation\n')

const checks: Array<[string, boolean, string]> = []

function check(label: string, ok: boolean, detail = '') {
  checks.push([label, ok, detail])
}

for (const file of ['09-frontmatter-unknown.md', '12-unknown-directive.md', '17-runbook.md']) {
  const md0 = readFileSync(join(CORPUS, file), 'utf8').replace(/\r\n/g, '\n')
  const before = parseMarkdown(md0)
  const after = parseMarkdown(trips.get(file)!.out)
  const yamlOf = (t: any) => t.children.find((c: any) => c.type === 'yaml')?.value ?? null
  if (yamlOf(before) !== null) {
    check(
      `${file}: front matter byte-identical`,
      yamlOf(before) === yamlOf(after),
      String(yamlOf(after)).slice(0, 60),
    )
  }
  const dirs = (t: any) =>
    JSON.stringify(
      normaliseMdast(t.children.filter((c: any) => String(c.type).endsWith('Directive'))),
    )
  check(`${file}: top-level directives deep-equal`, dirs(before) === dirs(after))
}

// The document from 12 with an entirely invented node type, forced through the
// rawMdast escape hatch.
{
  const invented = {
    type: 'root',
    children: [
      { type: 'paragraph', children: [{ type: 'text', value: 'before' }] },
      { type: 'somethingQuillHasNeverSeen', value: 'x', extra: { a: 1 } },
      { type: 'paragraph', children: [{ type: 'text', value: 'after' }] },
    ],
  }
  const { doc, warnings } = mdastToProseMirror(invented)
  const { tree } = proseMirrorToMdast(doc)
  check(
    'invented mdast node survives via rawMdast',
    JSON.stringify(normaliseMdast(invented)) === JSON.stringify(normaliseMdast(tree)),
    warnings.map((x) => x.code).join(','),
  )
}

// Every ProseMirror document the converter produces must be schema-valid.
{
  let valid = 0
  for (const [file, trip] of trips) {
    try {
      trip.doc.check()
      valid += 1
    } catch (error) {
      check(`${file}: doc.check()`, false, String(error))
    }
  }
  check(`all ${trips.size} documents produce a schema-valid ProseMirror doc`, valid === trips.size)
}

// Sanity: the schema really is TipTap's.
check(
  'schema node set',
  Object.keys(schema.nodes).length > 20,
  `${Object.keys(schema.nodes).length} nodes, ${Object.keys(schema.marks).length} marks`,
)

for (const [label, ok, detail] of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
}

const failed = rows.filter((r) => !r.idem).length + checks.filter(([, ok]) => !ok).length
console.log(
  `\n${checks.filter(([, ok]) => ok).length}/${checks.length} preservation checks pass; ` +
    `${
      rows
        .filter((r) => !r.sem)
        .map((r) => r.file)
        .join(', ') || 'no'
    } documents differ semantically.`,
)
if (failed > 0) process.exitCode = 1
