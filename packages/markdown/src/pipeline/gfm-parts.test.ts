import * as fc from 'fast-check'
import remarkDirective from 'remark-directive'
import remarkFrontmatter from 'remark-frontmatter'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { describe, expect, it } from 'vitest'

import { gfmPartsNeeded, remarkGfmParts } from './gfm-parts.ts'
import { GFM_OPTIONS } from './options.ts'

/** The parser as `processor.ts` builds it, every part on. */
const whole = unified()
  .use(remarkParse)
  .use(remarkGfm, GFM_OPTIONS)
  .use(remarkFrontmatter, ['yaml'])
  .use(remarkDirective)
  .freeze()

/** The parser with only the parts the text needs. */
function gated(text: string) {
  return unified()
    .use(remarkParse)
    .use(remarkGfmParts, gfmPartsNeeded(text))
    .use(remarkFrontmatter, ['yaml'])
    .use(remarkDirective)
    .parse(text)
}

/**
 * Lines chosen to sit on the edges of what the two optional parts read:
 * tables and things that look like them, literal autolinks and things that
 * nearly are, and the containers both can sit in.
 */
const LINES = [
  '| a | b |',
  '| --- | --- |',
  '|---|',
  'a | b',
  '--- | ---',
  ':-: | -:',
  '- | -',
  '\\| not a cell \\|',
  'a &#124; b',
  '&#124; --- &#124;',
  '> | quoted | table |',
  '> | --- | --- |',
  '- | listed | table |',
  '  | --- | --- |',
  '```',
  '~~~md',
  '    | indented | code |',
  'www.example.com',
  'Visit www.example.com/path?x=1.',
  'WWW.EXAMPLE.COM',
  'www',
  '.example.com',
  'https://example.com/a_(b)',
  'HTTPS://EXAMPLE.COM',
  'http',
  '://example.com',
  'ftp://example.com',
  'mail me at someone@example.com.',
  'mailto:someone@example.com',
  'xmpp:someone@example.com/resource',
  'someone@',
  '@example.com',
  '&#64;example.com someone&#64;example.com',
  '&#119;ww.example.com',
  'h&#116;tps://example.com',
  '`https://in.code.span` and `a | b`',
  '[www.in.a.link](https://example.com)',
  '<https://angle.example.com>',
  '*emphasis* ~~struck~~ - [ ] task',
  '[^1]: A footnote with www.example.com.',
  ':::note',
  ':::',
  '---',
  'title: front | matter',
  '# Heading | with pipe',
  '',
  'Plain words, nothing more.',
]

const documents = fc
  .array(fc.constantFrom(...LINES), { maxLength: 40 })
  .map((lines) => `${lines.join('\n')}\n`)

describe('gfmPartsNeeded', () => {
  it('needs nothing for text with no pipe, link start, address or reference', () => {
    expect(gfmPartsNeeded('# Plain\n\nJust words.\n')).toEqual({
      table: false,
      autolinkLiteral: false,
    })
  })

  it('needs a table for a pipe, and an autolink for every way one can start', () => {
    expect(gfmPartsNeeded('a | b').table).toBe(true)
    for (const text of ['www', 'WWW.', 'http:', 'HTTPS://', 'a@b', '&#64;']) {
      expect(gfmPartsNeeded(text).autolinkLiteral).toBe(true)
    }
  })
})

describe('reading with only the GFM parts a text needs', () => {
  it('gives the tree remark-gfm gives, for every edge of tables and literal autolinks', () => {
    fc.assert(
      fc.property(documents, (markdown) => {
        expect(gated(markdown)).toEqual(whole.parse(markdown))
      }),
      { numRuns: 3000 },
    )
  })

  it('gives the tree remark-gfm gives for each line on its own', () => {
    for (const line of LINES) expect(gated(line)).toEqual(whole.parse(line))
  })
})
