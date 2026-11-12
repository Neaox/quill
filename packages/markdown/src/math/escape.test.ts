import type { Paragraph, PhrasingContent, Root } from 'mdast'
import { describe, expect, it } from 'vitest'

import { parseMarkdown, stringifyMdast } from '../index.ts'

const text = (value: string): PhrasingContent => ({ type: 'text', value })
const math = (value: string): PhrasingContent => ({ type: 'inlineMath', value })
const strong = (...children: PhrasingContent[]): PhrasingContent => ({ type: 'strong', children })

const paragraph = (...children: PhrasingContent[]): Root => ({
  type: 'root',
  children: [{ type: 'paragraph', children } satisfies Paragraph],
})

const walk = (nodes: readonly PhrasingContent[]): string =>
  nodes
    .map((node) => {
      if (node.type === 'text') return node.value
      if (node.type === 'inlineMath') return `⟦${node.value}⟧`
      if (node.type === 'strong') return `‹${walk(node.children)}›`
      return '?'
    })
    .join('')

/**
 * What a paragraph says, as a string: its text with adjacent text joined, a formula as
 * `⟦source⟧` and the ends of strong text as `‹›`. Two trees that read alike project alike.
 */
function projection(tree: Root): string {
  const [first] = tree.children
  return first?.type === 'paragraph' ? walk(first.children) : `(${first?.type ?? 'nothing'})`
}

/** A small, repeatable generator: the same cases on every run. */
function sequence(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296
    return state / 4_294_967_296
  }
}

const pick = <T>(next: () => number, from: readonly T[]): T => {
  const chosen = from[Math.floor(next() * from.length)]
  if (chosen === undefined) throw new Error('nothing to pick')
  return chosen
}

/** Writes a tree and reads it back. */
const roundTrip = (tree: Root): Root => parseMarkdown(stringifyMdast(tree))

describe('writing dollars that are not math', () => {
  it('writes prices as they are, which is most of what a dollar is', () => {
    const tree = paragraph(text('from $501 to $2,500, or a $5 fee'))

    expect(stringifyMdast(tree)).toBe('from $501 to $2,500, or a $5 fee\n')
  })

  it('escapes the dollars of text that would otherwise be read as one formula', () => {
    expect(stringifyMdast(paragraph(text('the $x$ here')))).toBe(String.raw`the \$x\$ here` + '\n')
  })

  it('escapes them across emphasis, where the pair is on either side of it', () => {
    const tree = paragraph(text('a $x '), strong(text('b')), text(' y$ c'))

    const written = stringifyMdast(tree)

    expect(written).toBe(String.raw`a \$x **b** y\$ c` + '\n')
    expect(projection(roundTrip(tree))).toBe(projection(tree))
  })

  it('escapes a pair only as far as it needs to: the dollars either side of it are prose', () => {
    const tree = paragraph(text('$5 and $x$ and $6'))

    expect(stringifyMdast(tree)).toBe(String.raw`$5 and \$x\$ and $6` + '\n')
    expect(projection(roundTrip(tree))).toBe(projection(tree))
  })

  it('escapes the next dollar too when escaping one lets it pair with something further on', () => {
    const tree = paragraph(text('$a $b$ c$'))

    expect(projection(roundTrip(tree))).toBe(projection(tree))
  })
})

describe('writing a formula beside text', () => {
  it('writes a formula as it is when nothing stands against it', () => {
    expect(stringifyMdast(paragraph(text('so '), math('x^2'), text(', then')))).toBe(
      'so $x^2$, then\n',
    )
  })

  it('escapes a dollar of the text just before it, which would stop it opening', () => {
    const tree = paragraph(text('cost $'), math('x'), text(' each'))

    expect(stringifyMdast(tree)).toBe(String.raw`cost \$$x$ each` + '\n')
    expect(projection(roundTrip(tree))).toBe(projection(tree))
  })

  it('escapes a dollar of the text just after it, which would stop it closing', () => {
    const tree = paragraph(text('so '), math('x'), text('$ each'))

    expect(projection(roundTrip(tree))).toBe(projection(tree))
  })

  it('writes a digit straight after it as a character reference, since a dollar before a digit does not close', () => {
    const tree = paragraph(math('x'), text('5 apples'))

    expect(stringifyMdast(tree)).toBe('$x$&#x35; apples\n')
    expect(projection(roundTrip(tree))).toBe(projection(tree))
  })

  it('puts a zero-width space between two that touch', () => {
    const tree = paragraph(math('a'), math('b'))

    expect(projection(roundTrip(tree))).toBe('⟦a⟧\u200B⟦b⟧')
  })

  it('does not write a formula that has nothing in it', () => {
    expect(stringifyMdast(paragraph(text('a '), math('  '), text(' b')))).toBe('a  b\n')
  })

  it('writes a dollar inside a formula as TeX’s own, and a trailing backslash not at all', () => {
    expect(stringifyMdast(paragraph(math('a $ b')))).toBe(String.raw`$a \$ b$` + '\n')
    expect(stringifyMdast(paragraph(math('a\\')))).toBe('$a$\n')
    expect(stringifyMdast(paragraph(math('a\\\\')))).toBe(String.raw`$a\\$` + '\n')
  })

  it('writes an empty block as the fence that reads back as one', () => {
    const tree: Root = { type: 'root', children: [{ type: 'math', value: '' }] }

    expect(stringifyMdast(tree)).toBe('$$\n$$\n')
  })
})

describe('writing $$ at the start of a line', () => {
  it('escapes it, which a paragraph would otherwise read as a block', () => {
    const tree = paragraph(text('$$x$$'))

    expect(stringifyMdast(tree)).toBe(String.raw`\$$x$$` + '\n')
    expect(roundTrip(tree).children[0]?.type).toBe('paragraph')
    expect(projection(roundTrip(tree))).toBe('$$x$$')
  })

  it('escapes a line of a paragraph that is $$ alone, in the middle of it', () => {
    const tree = paragraph(text('a\n$$\nb\n$$'))

    expect(roundTrip(tree).children).toHaveLength(1)
    expect(projection(roundTrip(tree))).toBe(projection(tree))
  })
})

describe('whatever is written is read back as it was', () => {
  const PROSE = ['$', '$', '$', ' ', ' ', '5', 'a', '.', 'x']
  const FORMULAS = ['x', 'x^2', 'a b', '5', 'a+b']

  /** A paragraph of prose heavy in dollars, with formulas and strong text among it. */
  function randomParagraph(next: () => number): PhrasingContent[] {
    const children = Array.from({ length: 1 + Math.floor(next() * 5) }, (): PhrasingContent => {
      const kind = next()
      if (kind < 0.6) {
        return text(
          Array.from({ length: 1 + Math.floor(next() * 6) }, () => pick(next, PROSE)).join(''),
        )
      }
      return kind < 0.85 ? math(pick(next, FORMULAS)) : strong(text('b'))
    }).filter((child, index, all) => child.type !== 'strong' || all[index - 1]?.type !== 'strong')
    // A paragraph does not begin or end in space, so neither does this one.
    const [first] = children
    const last = children.at(-1)
    return children.map((child) => {
      if (child.type !== 'text') return child
      const value = child === first ? child.value.trimStart() : child.value
      return text(child === last ? value.trimEnd() : value)
    })
  }

  /** What reading the paragraph back should give: a space between formulas that touch. */
  function expectedProjection(children: readonly PhrasingContent[]): string {
    return projection(
      paragraph(
        ...children.flatMap((child, index) =>
          child.type === 'inlineMath' && children[index - 1]?.type === 'inlineMath'
            ? [text('​'), child]
            : [child],
        ),
      ),
    )
  }

  it('for two thousand paragraphs of dollars, digits, spaces, formulas and strong text', () => {
    const next = sequence(2026)
    const failures: string[] = []
    for (let index = 0; index < 2000; index += 1) {
      const children = randomParagraph(next)
      const written = stringifyMdast(paragraph(...children))
      const expected = expectedProjection(children).trim()
      // Nothing to say, or only a number and a dot at the start (a list, which is a different paragraph's problem).
      if (expected === '' || /^\d+[.)]/u.test(expected)) continue
      const actual = projection(parseMarkdown(written))
      if (actual !== expected)
        failures.push(`${JSON.stringify(written)}: ${actual} instead of ${expected}`)
    }
    expect(failures.slice(0, 8)).toEqual([])
  })
})
