import type { Nodes, Root } from 'mdast'
import { visit } from 'unist-util-visit'
import { describe, expect, it } from 'vitest'

import { parseMarkdown, stringifyMdast } from '../index.ts'

/** The math in a document: its kind and its source, in reading order. */
function mathIn(markdown: string): readonly string[] {
  const found: string[] = []
  visit(parseMarkdown(markdown), (node: Nodes) => {
    if (node.type === 'inlineMath') found.push(`inline:${node.value}`)
    if (node.type === 'math') found.push(`block:${node.value}`)
  })
  return found
}

const rootOf = (markdown: string): Root => parseMarkdown(markdown)

const written = (markdown: string): string => stringifyMdast(parseMarkdown(markdown))

describe('inline math', () => {
  it('reads $…$ as a formula in the middle of a sentence', () => {
    const [paragraph] = rootOf('The area is $\\pi r^2$, as before.').children

    expect(paragraph).toMatchObject({
      type: 'paragraph',
      children: [
        { type: 'text', value: 'The area is ' },
        { type: 'inlineMath', value: '\\pi r^2' },
        { type: 'text', value: ', as before.' },
      ],
    })
  })

  it('reads several in one paragraph, each on its own', () => {
    expect(mathIn('Take $a$ and $b$, then $c$.')).toEqual(['inline:a', 'inline:b', 'inline:c'])
  })

  it('leaves prices as prose', () => {
    expect(mathIn('- $501 to $2,500 per night\n- a $5 fee and a $10 fee')).toEqual([])
    expect(mathIn('It costs $5.')).toEqual([])
  })

  it('does not read a dollar followed by space, or one before a digit as the end', () => {
    expect(mathIn('a $ b $ c')).toEqual([])
    expect(mathIn('$x$5')).toEqual([])
  })

  it('lets what is inside be anything but a dollar, markup included', () => {
    expect(mathIn('$a*b*c$ and $x_1 + y_2$')).toEqual(['inline:a*b*c', 'inline:x_1 + y_2'])
    expect(mathIn(String.raw`$\{a\} \$5$`)).toEqual([String.raw`inline:\{a\} \$5`])
  })

  it('reads a formula that runs over a line ending', () => {
    expect(mathIn('so $a +\nb$ here')).toEqual(['inline:a +\nb'])
  })

  it('does not read an escaped dollar as the start of one', () => {
    expect(mathIn(String.raw`\$x\$ is prose`)).toEqual([])
  })

  it('leaves a dollar at the edge of the text, or an unterminated formula, as prose', () => {
    expect(mathIn('$')).toEqual([])
    expect(mathIn('$a')).toEqual([])
    expect(mathIn('$a\n')).toEqual([])
  })

  it('takes a backslash and the line ending after it as the formula’s', () => {
    expect(mathIn('$a\\\nb$')).toEqual(['inline:a\\\nb'])
  })

  it('does not read $$x$$ in a sentence, which is not inline math', () => {
    expect(mathIn('a $$x$$ b')).toEqual([])
  })

  it('does not look inside code', () => {
    expect(mathIn('`$a$` and\n\n```\n$b$\n```')).toEqual([])
  })

  it('reads one inside emphasis, a link, a heading, a list and a quote', () => {
    expect(
      mathIn('# About $x$\n\n*the $y$*\n\n[the $z$](https://example.com)\n\n- $w$\n\n> $v$'),
    ).toEqual(['inline:x', 'inline:y', 'inline:z', 'inline:w', 'inline:v'])
  })
})

describe('display math', () => {
  it('reads a $$ fence and what is between as a block', () => {
    expect(mathIn('$$\nE = mc^2\n$$')).toEqual(['block:E = mc^2'])
  })

  it('keeps every line of a long formula', () => {
    expect(mathIn('$$\na &= b \\\\\nc &= d\n$$')).toEqual(['block:a &= b \\\\\nc &= d'])
  })

  it('reads $$ x $$ alone on a line as a block', () => {
    expect(mathIn('$$ E = mc^2 $$')).toEqual(['block:E = mc^2'])
    expect(mathIn('$$E=mc^2$$')).toEqual(['block:E=mc^2'])
    expect(mathIn('$$ a $ b $$')).toEqual(['block:a $ b'])
    expect(mathIn('$$ x $$   ')).toEqual(['block:x'])
  })

  it('does not read a one-line block with no formula or text after its closing fence', () => {
    expect(mathIn('$$  $$')).toEqual([])
    expect(mathIn('$$x$$ y')).toEqual([])
  })

  it('accepts up to three spaces before a closing fence', () => {
    expect(mathIn('$$\nx\n  $$')).toEqual(['block:x'])
    expect(mathIn(' $$\n x\n $$')).toEqual(['block:x'])
  })

  it('takes the last two of three dollars as the end of the one-line form', () => {
    expect(mathIn('$$x$$$')).toEqual(['block:x$'])
  })

  it('keeps reading a block when a closing attempt is not a fence', () => {
    expect(mathIn('$$\nx\n$a\n$$')).toEqual(['block:x\n$a'])
    expect(mathIn('$$\nx\n$$$')).toEqual([])
    expect(mathIn('$$\nx\n$$ trailing')).toEqual([])
  })

  it('keeps what would be Markdown inside a block as it was written', () => {
    expect(mathIn('$$\n- a\n* b\n# c\n> d\n$$')).toEqual(['block:- a\n* b\n# c\n> d'])
  })

  it('reads a block after a paragraph with no blank line between, as a fence does', () => {
    const { children } = rootOf('Then:\n$$\nx\n$$')

    expect(children.map(({ type }) => type)).toEqual(['paragraph', 'math'])
  })

  it('reads a block inside a list item and a quote', () => {
    expect(mathIn('- item\n\n  $$\n  x\n  $$')).toEqual(['block:x'])
    expect(mathIn('> $$\n> x\n> $$')).toEqual(['block:x'])
  })

  it('does not let a lazy line outside the quote close a block inside it', () => {
    expect(mathIn('> $$\n> x\n$$')).toEqual([])
  })

  it('ends at the first closing fence, and reads what follows as the document goes on', () => {
    const { children } = rootOf('$$\nx\n$$\n\nafter $y$')

    expect(children.map(({ type }) => type)).toEqual(['math', 'paragraph'])
    expect(mathIn('$$\nx\n$$\n\nafter $y$')).toEqual(['block:x', 'inline:y'])
  })

  it('leaves a fence that is never closed as the prose it was', () => {
    expect(mathIn('$$\nnot closed')).toEqual([])
    expect(rootOf('$$\nnot closed').children.map(({ type }) => type)).toEqual(['paragraph'])
  })

  it('does not start a block from $$ with text after it that does not end in $$', () => {
    expect(mathIn('$$ x\ny $$')).toEqual([])
  })

  it('does not let a one-line block interrupt a paragraph', () => {
    expect(mathIn('some text\n$$x$$')).toEqual([])
  })

  it('does not read an empty block', () => {
    expect(mathIn('$$$$')).toEqual([])
  })

  it('reads a math fence of the GitHub kind as the same block', () => {
    const [node] = rootOf('```math\nx^2\n```').children
    expect(node).toMatchObject({ type: 'code', lang: 'math', value: 'x^2' })
  })
})

describe('writing math back', () => {
  it.each([
    'The area is $\\pi r^2$, as before.',
    'Take $a$ and $b$.',
    '$$\nE = mc^2\n$$',
    '$$\na &= b \\\\\nc &= d\n$$',
    '$$E = mc^2$$',
    '# About $x$',
  ])('writes %j as it was written', (markdown) => {
    expect(written(markdown)).toBe(`${markdown}\n`)
  })

  it('writes prices without a backslash', () => {
    expect(written('- $501 to $2,500 per night\n- a $5 fee and a $10 fee')).toBe(
      '- $501 to $2,500 per night\n- a $5 fee and a $10 fee\n',
    )
  })

  it('keeps a dollar in prose a dollar, escaped only where it would otherwise pair', () => {
    expect(written(String.raw`\$x\$ and $5`)).toBe(String.raw`\$x\$ and $5` + '\n')
  })
})
