import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import type { PhrasingContent, Root } from 'mdast'

import { parseMarkdown, stringifyMdast } from './processor.ts'

/**
 * A character is escaped only where the escape changes how the text reads
 * (ADR-002, ADR-003 requirement 5). `mdast-util-to-markdown` escapes `~`, `_`,
 * `*`, `&` and `[` wherever they appear in prose, so the first save rewrote an
 * author's `~3.5%`, `snake_case`, `B&B` and `[name]` as `\~3.5%`, `snake\_case`,
 * `B\&B` and `\[name]`: no different to a reader, and noise in every Git diff.
 */

/** Byte offsets are not semantics. */
function semantics(tree: Root): string {
  return JSON.stringify(tree, (key, value: unknown) =>
    key === 'position' || value === null ? undefined : value,
  )
}

function paragraph(...children: PhrasingContent[]): Root {
  return { type: 'root', children: [{ type: 'paragraph', children }] }
}

const CORPUS = fileURLToPath(new URL('../../corpus/', import.meta.url))

/** Every line of the corpus that holds one of these characters. */
const CORPUS_LINES = readdirSync(CORPUS, { recursive: true, encoding: 'utf8' })
  .filter((file) => file.endsWith('.md'))
  .flatMap((file) => readFileSync(`${CORPUS}${file}`, 'utf8').split('\n'))
  .filter((line) => /[~_*&[]/u.test(line))

const BYTE_FOR_BYTE = [
  'About ~3.5% of the cost, while `canonicalise` was ~93%.',
  '**~61** at most.',
  '| Wave | Writes |\n| --- | --- |\n| 1 | ~3,700 |',
  'A B&B, LOCK&STAY, and Tom & Jerry.',
  String.raw`An entity written out, \&amp;, stays escaped.`,
  'FINGERPRINT_VERSION, per_tenant and renderd/mod_tile.',
  'A rule numbered [R] and [S], "[Trustee] as trustee for the [name]".',
  'On to booking.com […] or the opposite […].',
  'An issue ([help/3625]) in parentheses.',
  '- [A1] The first source.\n- [A2] The second.',
  'Arithmetic: 2 * 3 * 4.',
  'The draw.io sources, and the www. prefix.',
  '- #253 is a ticket, not a heading.',
]

describe('escapes on a save', () => {
  it.each(BYTE_FOR_BYTE)('keep %s byte for byte', (markdown) => {
    const source = `${markdown}\n`
    expect(stringifyMdast(parseMarkdown(source))).toBe(source)
  })

  it('read back as the tree they were written from, for every corpus line', () => {
    const changed = CORPUS_LINES.filter((line) => {
      const tree = parseMarkdown(`${line}\n`)
      return semantics(parseMarkdown(stringifyMdast(tree))) !== semantics(tree)
    })
    expect(CORPUS_LINES.length).toBeGreaterThan(50)
    expect(changed).toEqual([])
  })

  it.each([
    ['a tilde pair', '~a~ and ~~b~~'],
    ['a tilde that would close', 'x ~open and close~ y'],
    ['a tilde beside punctuation', '(~a~) and "~b~"'],
    ['a tilde run', 'a ~~~ b'],
    ['underscores that would pair', '_a_ and __b__'],
    ['an underscore at the edge of a word', 'snake_ and _case'],
    ['asterisks that would pair', '*a* and a*b*c'],
    ['an asterisk at the start of a line', '* not a bullet'],
    ['an entity', '&amp; &#38; &#x26;'],
    ['a link', '[a](b) and ![c](d.png)'],
    ['a checkbox', '[ ] not a task'],
    ['a ticked checkbox', '[x] not a task either'],
    ['a bracket left open', '[open and never closed'],
    ['a definition', '[a]: b'],
    ['a heading', '# not a heading'],
  ])('are kept where the text is %s', (_name, value) => {
    const tree = paragraph({ type: 'text', value })
    expect(semantics(parseMarkdown(stringifyMdast(tree)))).toBe(semantics(tree))
  })

  it('still escape the dot of a `www.` address the way the library does', () => {
    // GFM reads `www\.example.com` as an address all the same; the escape is the
    // library's own, kept so nothing it wrote changes, and narrowed to `www.`.
    const tree = paragraph({ type: 'text', value: 'see www.example.com, or draw.io' })
    expect(stringifyMdast(tree)).toBe('see www\\.example.com, or draw.io\n')
  })

  it('keep a tilde from joining a strikethrough beside it', () => {
    const tree = paragraph(
      { type: 'text', value: 'x ~' },
      { type: 'delete', children: [{ type: 'text', value: 'gone' }] },
      { type: 'text', value: '~ y' },
    )
    expect(semantics(parseMarkdown(stringifyMdast(tree)))).toBe(semantics(tree))
  })

  it('keep an underscore and an asterisk from joining emphasis beside them', () => {
    const tree = paragraph(
      { type: 'text', value: 'a_' },
      { type: 'emphasis', children: [{ type: 'text', value: 'b' }] },
      { type: 'text', value: '* c' },
    )
    expect(semantics(parseMarkdown(stringifyMdast(tree)))).toBe(semantics(tree))
  })

  it('escape brackets in a document whose references could claim them', () => {
    // With a definition for `name`, an unescaped `[name]` is a link.
    for (const definition of ['[name]: https://example.com', '[^name]: A footnote.']) {
      const source = `The \\[name] and \\[^name] in brackets.\n\n${definition}\n`
      const tree = parseMarkdown(source)

      expect(semantics(parseMarkdown(stringifyMdast(tree)))).toBe(semantics(tree))
      expect(stringifyMdast(tree)).toBe(source)
    }
  })
})
