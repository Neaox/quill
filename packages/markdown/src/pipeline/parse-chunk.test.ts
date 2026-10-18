import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { planChunks } from './chunk-plan.ts'
import { createChunkSchedule } from './chunk-schedule.ts'
import { parseMarkdownInChunks, readChunk } from './parse-chunk.ts'
import type { ReadChunk } from './parse-chunk.ts'
import type { Root } from 'mdast'

import { parseMarkdown, stringifyMdast } from './processor.ts'

/**
 * A long document parsed in pieces is the document parsed whole: the same
 * tree, positions and all, and the same bytes when it is written back
 * (quill-plan.md section 31). Proven over the fidelity corpus, joined in any
 * order and cut at any size, and over line soups built from the constructs
 * that reach across blank lines — fences, containers, raw HTML, details,
 * front matter, lists, references and footnotes.
 */

const CORPUS = fileURLToPath(new URL('../../corpus/', import.meta.url))
const documents = readdirSync(CORPUS)
  .filter((file) => file.endsWith('.md'))
  .toSorted()
  .map((file) => readFileSync(`${CORPUS}${file}`, 'utf8'))

const sizes = fc.record({
  first: fc.integer({ min: 1, max: 3_000 }),
  rest: fc.integer({ min: 1, max: 6_000 }),
})

/** A document's tree and the bytes it is written back as. */
function asRead(tree: Root) {
  return { tree, written: stringifyMdast(tree) }
}

/** The document parsed whole. */
const whole = (markdown: string) => asRead(parseMarkdown(markdown))

/** The document parsed in pieces of about `cut`. */
const inPieces = (markdown: string, cut: { first: number; rest: number }) =>
  asRead(parseMarkdownInChunks(markdown, cut))

/** Lines that open, close or continue something across a blank line. */
const TRICKY_LINES = [
  '',
  '',
  '',
  'Text with [a] and [b][] and [^1] in it.',
  'Another paragraph mentioning [A] again.',
  '# Heading',
  '## Heading [b]',
  '2024 was a year.',
  '1. one',
  '- item',
  '  - nested',
  '  continued',
  '    indented code',
  '> quoted [a]',
  '> [b]: /quoted-definition',
  '[a]: https://example.com/a',
  '[b]: /b "Title"',
  '[^1]: The note.',
  '    More of the note.',
  '```',
  '```ts',
  '  ```',
  '~~~',
  '````',
  ':::note',
  ':::',
  '::::',
  '::: code-group',
  '```js tab="JavaScript"',
  '<!--',
  '-->',
  '<!-- one line -->',
  '<details>',
  '<details open>',
  '<summary>More</summary>',
  '</details>',
  '<div>',
  '</div>',
  '<script>',
  '</script>',
  '| a | b |',
  '| - | - |',
  '---',
  '***',
  'Setext',
  '===',
  '&copy; &amp; &nbsp; done',
  'www.example.com and https://example.com/x.',
  '  <!--',
  ' <details>',
  '   ~~~',
  '- ```',
  '> ```',
  '>',
  '> <details>',
  '  </details>',
  '<pre>',
  '</pre>',
  '  [a]: /indented',
  '[A long',
  'label]: /wrapped',
  'See [a long label].',
  ':::callout{type=note}',
  '  :::',
  '<?php',
  '?>',
  '<![CDATA[',
  ']]>',
  '* star',
  '10) ten',
  '[^note]:',
  '    note body',
  'Term[^note] here.',
]

const soup = fc
  .array(fc.constantFrom(...TRICKY_LINES), { maxLength: 80 })
  .map((lines) => lines.join('\n'))

/** Lines that read as prose at the left margin, which is where the scan cuts. */
const PROSE = [
  'Text with [a] and [b][] and [^1] in it.',
  'Plain text.',
  '# Heading',
  'Mentions [quoted label] too.',
  '',
]

const inside = fc
  .array(fc.constantFrom(...PROSE), { maxLength: 6 })
  .map((lines) => lines.join('\n'))

/**
 * Whole constructs, each holding blank lines and prose a cut could fall in,
 * between paragraphs where it may: documents that cut into many pieces, borrow
 * definitions across them, and now and then fool the scan.
 */
const block = fc.oneof(
  { weight: 6, arbitrary: fc.constantFrom(...PROSE.filter((line) => line !== '')) },
  {
    weight: 2,
    arbitrary: fc
      .tuple(fc.constantFrom('```', '~~~', '````ts'), inside)
      .map(([f, body]) => `${f}\n${body}\n${f.replaceAll(/[a-z]/gu, '')}`),
  },
  { weight: 2, arbitrary: inside.map((body) => `:::note\n\n${body}\n\n:::`) },
  { weight: 1, arbitrary: inside.map((body) => `<!--\n${body}\n-->`) },
  {
    weight: 1,
    arbitrary: inside.map((body) => `<details>\n<summary>More</summary>\n\n${body}\n\n</details>`),
  },
  {
    weight: 1,
    arbitrary: inside.map((body) => `- item\n\n  ${body.replaceAll('\n', '\n  ')}\n- next`),
  },
  { weight: 1, arbitrary: inside.map((body) => `- item\n  \`\`\`\n${body}\n\`\`\``) },
  {
    weight: 2,
    arbitrary: fc.constantFrom('[a]: /a', '[b]: /b "B"', '[^1]: The note.', '> [quoted label]: /q'),
  },
  { weight: 1, arbitrary: fc.constantFrom(...TRICKY_LINES) },
  // Definitions and references inside containers, which micromark reads a
  // level at a time (`chunk-schedule.ts`).
  {
    weight: 3,
    arbitrary: fc.constantFrom(
      ':::note\n[a]: /in-directive\n:::',
      '::::outer\n:::inner\n[b]: /deep\n:::\n::::',
      ':::note\nInside [a] and [b] and [^1].\n:::',
      ':::note[Label [a]]\nText\n:::',
      '> :::note\n> [quoted label]: /q\n> :::',
      ':::note\n[^1]: Directive note.\n:::',
      '::::outer\n:::inner\nDeep [a] [b] [^1] [quoted label]\n:::\n::::',
    ),
  },
)

const blocks = fc
  .tuple(fc.array(block, { maxLength: 40 }), fc.constantFrom('\n\n', '\n\n\n', '\n'))
  .map(([parts, gap]) => parts.join(gap))

describe('parsing in pieces', () => {
  it.each(documents.map((markdown, index) => [index + 1, markdown]))(
    'parses corpus document %i in the smallest pieces exactly as whole',
    (_index, markdown) => {
      expect(inPieces(markdown, { first: 1, rest: 1 })).toEqual(whole(markdown))
    },
  )

  it('parses the corpus joined in any order and cut at any size exactly as whole', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...documents), { minLength: 1, maxLength: 4 }),
        sizes,
        (joined, cut) => {
          const markdown = joined.join('\n')
          expect(inPieces(markdown, cut)).toEqual(whole(markdown))
        },
      ),
      { numRuns: 60 },
    )
  })

  it('parses any soup of fences, containers, HTML and references exactly as whole', () => {
    fc.assert(
      fc.property(soup, sizes, (markdown, cut) => {
        expect(inPieces(markdown, cut)).toEqual(whole(markdown))
      }),
      { numRuns: 400 },
    )
  })

  it('parses exactly as whole when a fence the scan took for closed was not', () => {
    // The fence opens in the list item, which the unindented line closes, so
    // the next fence line opens a fence that runs to the end of the document.
    const markdown = '- item\n  ```\nout\n```\n\nInside the fence.\n\nStill inside.\n'
    expect(inPieces(markdown, { first: 1, rest: 1 })).toEqual(whole(markdown))
    expect(parseMarkdownInChunks(markdown, { first: 1, rest: 1 }).children.at(-1)?.type).toBe(
      'code',
    )
  })

  it('really cuts: the corpus comes apart into many pieces', () => {
    const pieces = documents.map(
      (markdown) => planChunks(markdown, { first: 1, rest: 1 }).spans.length,
    )
    expect(pieces.reduce((sum, count) => sum + count, 0)).toBeGreaterThan(documents.length * 8)
  })

  it('never has to join the corpus back together: every cut the scan makes holds', () => {
    for (const markdown of documents) {
      const plan = planChunks(markdown, { first: 1, rest: 1 })
      const schedule = createChunkSchedule<ReadChunk>(plan)
      let delivered = 0
      for (let job = schedule.next(); job !== undefined; job = schedule.next()) {
        delivered += schedule.settle(readChunk(job)).length
      }
      expect(delivered).toBe(plan.spans.length)
    }
  })

  it('parses any run of whole constructs, cut into many pieces, exactly as whole', () => {
    fc.assert(
      fc.property(blocks, sizes, (markdown, cut) => {
        expect(inPieces(markdown, cut)).toEqual(whole(markdown))
      }),
      { numRuns: 400 },
    )
  })

  it('parses a document with Windows line endings and a byte-order mark exactly as whole', () => {
    const markdown = '\uFEFF# One\r\n\r\nText [a].\r\n\r\nMore.\r\n\r\n[a]: /x\r\n'
    expect(inPieces(markdown, { first: 1, rest: 1 })).toEqual(whole(markdown))
  })
})

describe('reading one piece', () => {
  it('moves its positions to where it sits in the document', () => {
    const read = readChunk({
      id: 1,
      text: 'Text.\n',
      line: 4,
      offset: 40,
      borrowed: undefined,
      blankLinesBefore: undefined,
    })
    expect(read.payload.children[0]?.position).toEqual({
      start: { line: 5, column: 1, offset: 40 },
      end: { line: 5, column: 6, offset: 45 },
    })
    expect(read.payload.end).toEqual({ line: 6, column: 1, offset: 46 })
  })

  it('says when its last block runs to its end', () => {
    const open = readChunk({
      id: 1,
      text: '```\ncode\n\n',
      line: 0,
      offset: 0,
      borrowed: undefined,
      blankLinesBefore: undefined,
    })
    const closed = readChunk({
      id: 2,
      text: 'Text.\n\n',
      line: 0,
      offset: 0,
      borrowed: undefined,
      blankLinesBefore: undefined,
    })
    expect(open.endsOpen).toBe(true)
    expect(closed.endsOpen).toBe(false)
    // A blank line of spaces is still the end of what the piece holds.
    const spaced = readChunk({
      id: 4,
      text: 'Text.\n  \n',
      line: 0,
      offset: 0,
      borrowed: undefined,
      blankLinesBefore: undefined,
    })
    expect(spaced.endsOpen).toBe(false)
    // Wherever in the document the piece sits.
    const later = readChunk({
      id: 3,
      text: 'Text.\n\n',
      line: 40,
      offset: 900,
      borrowed: undefined,
      blankLinesBefore: 1,
    })
    expect(later.endsOpen).toBe(false)
  })

  it('finds its definitions wherever they sit', () => {
    const read = readChunk({
      id: 1,
      text: '> [Quoted]: /q\n\n[^n]: Note.\n',
      line: 0,
      offset: 0,
      borrowed: undefined,
      blankLinesBefore: undefined,
    })
    expect(read.definitions).toEqual(
      expect.arrayContaining([
        { label: 'Quoted', footnote: false, depth: 0 },
        { label: 'n', footnote: true, depth: 0 },
      ]),
    )
  })

  it('refuses borrowed definitions that did not parse as definitions', () => {
    expect(() =>
      readChunk({
        id: 1,
        text: 'Not a definition.\n\nText.\n',
        line: 0,
        offset: 0,
        borrowed: { before: 1, after: 0 },
        blankLinesBefore: undefined,
      }),
    ).toThrow('borrowed definitions')
  })
})
