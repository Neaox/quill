import { describe, expect, it } from 'vitest'

import { planChunks, referenceKey } from './chunk-plan.ts'
import type { ChunkPlan } from './chunk-plan.ts'

/**
 * Where a long document may be cut (quill-plan.md section 31). Every piece
 * must parse alone as it does in the whole, so each case is a construct with
 * a blank line and an unindented line inside it, and the cut must go around
 * it. Sizes of one character cut at every point the scan allows.
 */

const EVERYWHERE = { first: 1, rest: 1 }

const pieces = (plan: ChunkPlan) =>
  plan.spans.map((span) => plan.source.slice(span.start, span.end))

const cut = (source: string) => pieces(planChunks(source, EVERYWHERE))

describe('cutting a document into pieces', () => {
  it('cuts after a blank line before a new paragraph or heading, and covers the source exactly', () => {
    const source = '# One\n\nText.\n\n## Two\n\n2024 was long.\n'
    expect(cut(source)).toEqual(['# One\n\n', 'Text.\n\n', '## Two\n\n', '2024 was long.\n'])
  })

  it('records the line each piece starts on', () => {
    const plan = planChunks('# One\n\nText.\n\n\nMore.\n', EVERYWHERE)
    expect(plan.spans.map((span) => span.line)).toEqual([0, 2, 5])
  })

  it('waits until a piece is as long as asked', () => {
    const source = 'A.\n\nB.\n\nC.\n\nD.\n'
    expect(pieces(planChunks(source, { first: 4, rest: 8 }))).toEqual([
      'A.\n\n',
      'B.\n\nC.\n\n',
      'D.\n',
    ])
  })

  it.each([
    ['a list item', '- one\n\n- two\n'],
    ['an ordered list item', 'Text.\n\n1. one\n'],
    ['an indented continuation', '- one\n\n  more of one\n'],
    ['a fence', 'Text.\n\n```\ncode\n```\n'],
    ['a quote', 'Text.\n\n> quoted\n'],
    ['a definition', 'Text.\n\n[a]: https://example.com\n'],
    ['raw HTML', 'Text.\n\n<div>x</div>\n'],
  ])('does not cut before %s', (_name, source) => {
    expect(cut(source)).toEqual([source])
  })

  it.each([
    ['a backtick fence', '```\none\n\ntwo\n```\n'],
    ['a tilde fence holding a shorter one', '~~~~\n~~~\n\ntwo\n~~~~\n'],
    ['a directive container', ':::note\none\n\ntwo\n:::\n'],
    ['a spaced code group', '::: code-group\n\nText\n\n:::\n'],
    ['nested containers', '::::outer\n:::inner\n\nx\n:::\n\ny\n::::\n'],
    ['an HTML comment', '<!--\none\n\ntwo\n-->\n'],
    ['a script', '<script>\nlet a\n\nlet b\n</script>\n'],
    ['front matter', '---\ntitle: x\n\nsummary: y\n---\n'],
    ['a details element', '<details>\n<summary>More</summary>\n\nInside.\n\n</details>\n'],
  ])('does not cut inside %s', (_name, inside) => {
    const source = `${inside}\nAfter.\n`
    expect(cut(source)).toEqual([`${inside}\n`, 'After.\n'])
  })

  it('does not take a run of backticks with a backtick after it for a fence', () => {
    expect(cut('``` not`a fence\n\nAfter.\n')).toEqual(['``` not`a fence\n\n', 'After.\n'])
  })

  it('cuts after a comment closed on the line it opened', () => {
    expect(cut('<!-- note -->\n\nAfter.\n')).toEqual(['<!-- note -->\n\n', 'After.\n'])
  })

  it('does not cut between the first details tag and the last, balanced or not', () => {
    // A stray closing tag means no details at this level is read at all, which
    // only a reader that sees every tag at once can decide.
    const tags = '<details>\n\nInside.\n\n</details>\n\nBetween.\n\n</details>\n\n'
    expect(cut(`Before.\n\n${tags}After.\n`)).toEqual([`Before.\n\n${tags}`, 'After.\n'])
  })

  it('collects what each piece could define, footnotes and quoted ones too', () => {
    const plan = planChunks(
      'See [a].\n\n[A]: https://example.com\n\n> [quoted label]: /q\n\nNote[^1].\n\n[^1]: The note.\n',
      EVERYWHERE,
    )
    expect(plan.spans.flatMap((span) => span.definitions)).toEqual([
      referenceKey('a', false),
      referenceKey('Quoted Label', false),
      referenceKey('1', true),
    ])
  })

  it('reads a label that wraps onto the next line', () => {
    const plan = planChunks('[a long\nlabel]: /x\n', EVERYWHERE)
    expect(plan.spans.flatMap((span) => span.definitions)).toEqual([
      referenceKey('a long label', false),
    ])
  })

  it('does not take a link for a definition', () => {
    const plan = planChunks('[a](/x) and [b]\n', EVERYWHERE)
    expect(plan.spans.flatMap((span) => span.definitions)).toEqual([])
  })

  it('collects a definition even inside what it takes for a fence, in case it is wrong', () => {
    const plan = planChunks('```\n[c]: /c\n```\n', EVERYWHERE)
    expect(plan.spans.flatMap((span) => span.definitions)).toEqual([referenceKey('c', false)])
  })

  it('keys a reference however its case, spacing or container markers fall', () => {
    expect(referenceKey('Foo  Bar', false)).toBe(referenceKey('foo\n> bar', false))
    expect(referenceKey('1', true)).not.toBe(referenceKey('1', false))
  })

  it('is one piece when there is nowhere to cut', () => {
    expect(cut('one long paragraph\nthat goes on\n')).toEqual([
      'one long paragraph\nthat goes on\n',
    ])
    expect(planChunks('').spans).toEqual([{ start: 0, end: 0, line: 0, definitions: [] }])
  })
})
