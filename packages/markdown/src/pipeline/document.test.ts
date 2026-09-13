import {
  array,
  assert,
  constantFrom,
  dictionary,
  integer,
  oneof,
  property,
  string,
  stringMatching,
} from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { Root, RootContent } from 'mdast'

import { renderHtml } from '../render/html.ts'
import { parseDocument } from './parse-document.ts'
import { serializeDocument, serializeDocumentWithWarnings } from './serialize-document.ts'

const FRONT_MATTER = `---
title: Fidelity
id: 0bd9e2a6-3a3a-4a2e-9d1e-3f5c9d2b7a11
tags:
  - markdown
# a comment inside the front matter
customer:
  name: Acme
  tier: enterprise
emptyValue:
quotedString: "keep   my    spacing"
---

# Fidelity

Body text.
`

describe('parseDocument', () => {
  it('separates front matter from the tree and keeps the YAML verbatim', () => {
    const parsed = parseDocument(FRONT_MATTER)

    expect(parsed.frontMatter['title']).toBe('Fidelity')
    expect(parsed.frontMatter['customer']).toEqual({ name: 'Acme', tier: 'enterprise' })
    expect(parsed.warnings).toEqual([])
    expect(parsed.ast.children[0]?.type).toBe('yaml')
  })

  it('reports a document with no front matter as having none', () => {
    const parsed = parseDocument('# Only a heading\n')

    expect(parsed.frontMatter).toEqual({})
    expect(parsed.warnings).toEqual([])
  })

  it('degrades malformed front matter to a warning instead of failing', () => {
    const parsed = parseDocument('---\n: :\n  - [\n---\n\nBody.\n')

    expect(parsed.frontMatter).toEqual({})
    expect(parsed.warnings[0]?.code).toBe('front-matter-parse')
  })

  it('warns when front matter is not a mapping', () => {
    const parsed = parseDocument('---\n- one\n- two\n---\n\nBody.\n')

    expect(parsed.warnings[0]?.code).toBe('front-matter-not-a-mapping')
  })

  it('parses directives, front matter and GFM in one pass', () => {
    const parsed = parseDocument(':::callout{type=warning}\nCareful.\n:::\n')

    expect(parsed.ast.children[0]?.type).toBe('containerDirective')
  })
})

describe('serializeDocument', () => {
  it('writes an unchanged document back byte for byte', () => {
    expect(serializeDocument(parseDocument(FRONT_MATTER))).toBe(FRONT_MATTER)
  })

  it('keeps comments, key order and quoting when one field changes', () => {
    const parsed = parseDocument(FRONT_MATTER)
    const output = serializeDocument({
      ...parsed,
      frontMatter: { ...parsed.frontMatter, title: 'Renamed' },
    })

    expect(output).toContain('title: Renamed')
    expect(output).toContain('# a comment inside the front matter')
    expect(output).toContain('quotedString: "keep   my    spacing"')
    expect(output.indexOf('title:')).toBeLessThan(output.indexOf('id:'))
  })

  it('adds and removes fields without disturbing the rest', () => {
    const parsed = parseDocument(FRONT_MATTER)
    const { title: _removed, ...rest } = parsed.frontMatter
    const output = serializeDocument({ ...parsed, frontMatter: { ...rest, order: 3 } })

    expect(output).not.toContain('title:')
    expect(output).toContain('order: 3')
    expect(output).toContain('# a comment inside the front matter')
  })

  it('writes front matter for a document that had none', () => {
    const parsed = parseDocument('# Heading\n')
    const output = serializeDocument({ ...parsed, frontMatter: { id: 'abc', order: 1 } })

    expect(output).toBe('---\nid: abc\norder: 1\n---\n\n# Heading\n')
  })

  it('leaves unparseable front matter exactly as the author wrote it', () => {
    const source = '---\n: :\n  - [\n---\n\nBody.\n'

    expect(serializeDocument(parseDocument(source))).toBe(source)
  })

  it('falls back to a fresh block when the source cannot be edited surgically', () => {
    const parsed = parseDocument('---\n: :\n  - [\n---\n\nBody.\n')
    const output = serializeDocument({ ...parsed, frontMatter: { id: 'abc' } })

    expect(output).toBe('---\nid: abc\n---\n\nBody.\n')
  })

  it('removes the block when the front matter node is removed from the tree', () => {
    const parsed = parseDocument(FRONT_MATTER)
    const ast: Root = { ...parsed.ast, children: parsed.ast.children.slice(1) }

    expect(serializeDocument({ frontMatter: {}, ast })).toBe('# Fidelity\n\nBody text.\n')
  })

  it('does not pad table cells, so one edit changes one line', () => {
    const output = serializeDocument(parseDocument('| a | bbbb |\n| - | - |\n| 1 | 2 |\n'))

    expect(output).toBe('| a | bbbb |\n| - | - |\n| 1 | 2 |\n')
  })

  it('reports what it had to degrade, without changing what it returns', () => {
    const parsed = parseDocument('# Heading\n')
    const ast: Root = {
      type: 'root',
      children: [
        ...parsed.ast.children,
        { type: 'somethingNeverSeen', children: [{ type: 'text', value: '# Not a heading' }] },
      ] as RootContent[],
    }
    const document = { frontMatter: {}, ast }
    const { markdown, warnings } = serializeDocumentWithWarnings(document)

    expect(warnings).toEqual([{ code: 'unserialisable-node', detail: 'somethingNeverSeen' }])
    expect(markdown).toBe('# Heading\n\n\\# Not a heading\n')
    expect(serializeDocument(document)).toBe(markdown)
  })

  it('escapes both colons so a literal "::" cannot re-parse as a directive', () => {
    const output = serializeDocument(parseDocument('::not-a-directive because of the space\n'))

    expect(output).toBe('\\:\\:not-a-directive because of the space\n')
    expect(serializeDocument(parseDocument(output))).toBe(output)
  })
})

describe('serialise after parse', () => {
  const fragment = constantFrom(
    '# Heading one\n',
    '## Heading two\n',
    'Prose with *emphasis*, **strong**, ~~strike~~ and `code`.\n',
    '- alpha\n- beta\n',
    '1. one\n2. two\n',
    '- [ ] todo\n- [x] done\n',
    '| a | b |\n| - | - |\n| 1 | 2 |\n',
    '```ts\nconst answer = 42\n```\n',
    '> A quotation.\n',
    ':::callout{type=note}\nBody of the callout.\n:::\n',
    ':::wide\nWide body.\n:::\n',
    ':::unknown-thing{k=v}\nSomething new.\n:::\n',
    '::leaf-thing{a=b}\n',
    'Text with :inline[label]{k=v} inside.\n',
    'A literal :: in prose.\n',
    '![alt text](img.png "Caption")\n',
    'A [reference][ref] link.\n\n[ref]: https://example.com "Title"\n',
    '<div align="center">Raw HTML</div>\n',
  )

  it('is idempotent for any combination of constructs', () => {
    assert(
      property(array(fragment, { minLength: 1, maxLength: 8 }), (parts) => {
        const once = serializeDocument(parseDocument(parts.join('\n')))
        const twice = serializeDocument(parseDocument(once))
        expect(twice).toBe(once)
      }),
      { numRuns: 200 },
    )
  })

  it('means the same thing after a round trip, for any text at all', () => {
    // The hazards are the characters this pipeline gives meaning to: `:` and
    // `::` start a directive, `|` builds a table, `{}` carry attributes, `\r`
    // and a byte-order mark are normalised at parse, and a lone `:name` is the
    // case that used to delete the prose around it.
    const hazard = constantFrom(
      ':',
      '::',
      ':::',
      ':name',
      ':name[label]',
      '::leaf{a=b}',
      '3:2',
      'data:image/png',
      '|',
      '| a | b |',
      '{k=v}',
      '\r\n',
      '\n',
      '﻿',
      '\\',
      '*',
      '`',
      '#',
      '- ',
      '> ',
      'text',
      '  ',
    )

    assert(
      property(
        oneof(
          array(hazard, { minLength: 1, maxLength: 12 }).map((parts) => parts.join('')),
          string({ unit: 'grapheme', maxLength: 80 }),
        ),
        (source) => {
          const once = serializeDocument(parseDocument(source))
          const twice = serializeDocument(parseDocument(once))
          const thrice = serializeDocument(parseDocument(twice))

          // The bytes settle. A document written by this package is a fixed
          // point on the first write (the test above, and every corpus file);
          // text contrived so that *writing* it changes how it re-reads — a
          // trailing `:` after a directive, a colon run that has to be escaped —
          // takes one more pass and then never moves again, which is what stops
          // a Git sync oscillating between two forms for ever.
          expect(thrice).toBe(twice)

          // And from the canonical form onward the document a reader is shown
          // never changes again, however much the tree is re-shaped underneath:
          // the README's formatting-only normalisations move text between nodes
          // (a line ending inside a code span becomes a space) and escaping a
          // colon run turns one text node into three, and none of that is
          // allowed to alter a single character of what is rendered.
          expect(renderHtml(parseDocument(twice).ast)).toBe(renderHtml(parseDocument(once).ast))
        },
      ),
      { numRuns: 500 },
    )
  })

  it('is idempotent with front matter the schema does not know', () => {
    assert(
      property(
        array(fragment, { minLength: 1, maxLength: 5 }),
        dictionary(stringMatching(/^[a-z][a-z0-9]{0,7}$/), integer(), {
          minKeys: 1,
          maxKeys: 4,
        }),
        (parts, extra) => {
          const source = `---\n${Object.entries(extra)
            .map(([key, value]) => `${key}: ${value}`)
            .join('\n')}\n---\n\n${parts.join('\n')}`
          const once = serializeDocument(parseDocument(source))
          const parsedOnce = parseDocument(once)

          expect(parsedOnce.frontMatter).toEqual(extra)
          expect(serializeDocument(parsedOnce)).toBe(once)
        },
      ),
      { numRuns: 100 },
    )
  })
})
