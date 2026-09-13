// The individual findings behind docs/research/r03-editor.md, each reproducible
// on its own. Run with: node probes.ts
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkFrontmatter from 'remark-frontmatter'
import remarkDirective from 'remark-directive'
import remarkStringify from 'remark-stringify'
import { getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { parseMarkdown, stringifyMdast } from './src/pipeline.ts'
import { schema } from './src/schema.ts'

const strip = (t: unknown) => JSON.stringify(t, (k, v) => (k === 'position' ? undefined : v))
const line = (s: string) => console.log('\n' + s + '\n' + '-'.repeat(s.length))

// --- A. TipTap's Code mark excludes every other mark ----------------------

line('A. TipTap Code mark: excludes')
{
  const stock = getSchema([StarterKit])
  console.log(
    '  stock StarterKit  code.excluded:',
    stock.marks.code.excluded.map((m) => m.name).join(',') || '(none)',
  )
  console.log(
    '  Quill schema      code.excluded:',
    schema.marks.code.excluded.map((m) => m.name).join(',') || '(none)',
  )
  const doc = schema.nodes.doc.create(null, [
    schema.nodes.paragraph.create(null, [
      schema.text('parse()', [
        schema.marks.link.create({ href: './api.md' }),
        schema.marks.code.create(),
      ]),
    ]),
  ])
  doc.check()
  console.log('  "[`parse()`](./api.md)" is schema-valid only with the override: ok')
}

// --- B. "::" in prose becomes a directive on round trip -------------------

line('B. remark-stringify invents a directive from a literal "::"')
{
  const base = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkFrontmatter, ['yaml'])
    .use(remarkDirective)
  const broken = base().use(remarkStringify, { fences: true })()
  const md = '::not-a-directive because of the space\n'
  const out = broken.stringify(broken.parse(md) as never)
  console.log('  in          ', JSON.stringify(md))
  console.log('  stock out   ', JSON.stringify(out))
  console.log('  re-parsed to', strip(broken.parse(out)).slice(0, 160))
  console.log('  fixed out   ', JSON.stringify(stringifyMdast(parseMarkdown(md))))
  console.log(
    '  fixed stable',
    strip(parseMarkdown(md)) === strip(parseMarkdown(stringifyMdast(parseMarkdown(md)))),
  )
}

// --- C. Table padding and Git diff noise ----------------------------------

line('C. tablePipeAlign and diff noise')
{
  const table =
    '| Command | Description |\n| --- | --- |\n| `a` | short |\n| `pnpm check` | Runs the full quality gate |\n'
  for (const tablePipeAlign of [true, false]) {
    const proc = unified()
      .use(remarkParse)
      .use(remarkGfm, { tablePipeAlign })
      .use(remarkStringify, { fences: true })()
    const t: any = proc.parse(table)
    const before = proc.stringify(t as never)
    t.children[0].children[2].children[1].children[0].value = 'shorter'
    const after = proc.stringify(t as never)
    const bl = before.split('\n')
    const al = after.split('\n')
    console.log(
      `  tablePipeAlign=${String(tablePipeAlign).padEnd(5)} one-cell edit rewrites ` +
        `${bl.filter((l, i) => l !== al[i]).length} of ${bl.length - 1} table lines`,
    )
  }
}

// --- D. Per-node emphasis marker needs a custom handler -------------------

line('D. Keeping "*" vs "_" per node')
{
  const t: any = parseMarkdown('a *one* and _two_\n')
  t.children[0].children[1].marker = '*'
  t.children[0].children[3].marker = '_'
  console.log('  node.marker alone is ignored:', JSON.stringify(stringifyMdast(t)))
  const withHandlers = unified()
    .use(remarkParse)
    .use(remarkStringify, {
      fences: true,
      handlers: {
        emphasis: (node: any, _p: unknown, state: any, info: any) => {
          const marker = node.marker || state.options.emphasis || '*'
          const exit = state.enter('emphasis')
          const value =
            marker +
            state.containerPhrasing(node, { before: marker, after: marker, ...info }) +
            marker
          exit()
          return value
        },
      },
    })()
  const t2: any = withHandlers.parse('a *one* and _two_\n')
  t2.children[0].children[1].marker = '*'
  t2.children[0].children[3].marker = '_'
  console.log('  with a custom handler:      ', JSON.stringify(withHandlers.stringify(t2 as never)))
}

// --- E. Directive nesting and ragged tables -------------------------------

line('E. Normalisations remark applies on its own')
{
  const cases = [
    ':::wide\n:::callout{type=warning}\nx\n:::\n:::\n',
    '| One | Two | Three |\n| --- | --- | --- |\n| a | b |\n',
    'hard break with two spaces:  \nnext line\n',
    'Character references: &copy; &amp; &lt;tag&gt;\n',
    'A bare URL https://example.com/x linkified by GFM\n',
  ]
  for (const md of cases) {
    const out = stringifyMdast(parseMarkdown(md))
    console.log(`  ${JSON.stringify(md)}\n    -> ${JSON.stringify(out)}`)
  }
}
