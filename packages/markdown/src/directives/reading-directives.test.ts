import { describe, expect, it } from 'vitest'
import type { ContainerDirective, TextDirective } from 'mdast-util-directive'
import type { Root } from 'mdast'

import { parseMarkdown, stringifyMdast } from '../pipeline/processor.ts'
import { badgeDirective, BADGE_TONES } from './badge.ts'
import { cardsDirective } from './cards.ts'
import { figureDirective } from './figure.ts'
import { findDirective, validateDirectives } from './registry.ts'
import { smallDirective } from './small.ts'

function container(markdown: string): ContainerDirective {
  const found = parseMarkdown(markdown).children.find(
    (node): node is ContainerDirective => node.type === 'containerDirective',
  )
  if (found === undefined) throw new Error(`no container directive in ${markdown}`)
  return found
}

function inline(markdown: string): TextDirective {
  const [paragraph] = parseMarkdown(markdown).children
  const found =
    paragraph?.type === 'paragraph'
      ? paragraph.children.find((child) => child.type === 'textDirective')
      : undefined
  if (found === undefined) throw new Error(`no text directive in ${markdown}`)
  return found
}

function write(node: ContainerDirective | TextDirective): string {
  const tree: Root =
    node.type === 'containerDirective'
      ? { type: 'root', children: [node] }
      : { type: 'root', children: [{ type: 'paragraph', children: [node] }] }
  return stringifyMdast(tree)
}

describe('badge', () => {
  it('shares its tones with the interface badge', () => {
    expect(BADGE_TONES).toEqual(['neutral', 'accent', 'success', 'warning', 'danger'])
  })

  it('reads its label and tone', () => {
    expect(badgeDirective.parse(inline('A :badge[Built]{tone=success} cell.\n'))).toEqual({
      label: 'Built',
      tone: 'success',
      name: 'badge',
    })
  })

  it('is neutral when no tone is given', () => {
    expect(badgeDirective.parse(inline(':badge[Designed]\n')).tone).toBe('neutral')
  })

  it('degrades an unknown tone to neutral, and says so', () => {
    const node = inline(':badge[Odd]{tone=ultraviolet}\n')

    expect(badgeDirective.parse(node).tone).toBe('neutral')
    expect(badgeDirective.validate(node)).toEqual([
      {
        path: 'tone',
        message: 'Unknown badge tone "ultraviolet"; rendered as neutral.',
        severity: 'warning',
      },
    ])
  })

  it('warns about a badge with nothing to say', () => {
    expect(badgeDirective.validate(inline('A :badge[] here.\n'))).toEqual([
      { path: '', message: 'A badge needs a label; its text is its meaning.', severity: 'warning' },
    ])
  })

  it('writes back, leaving a neutral tone implicit', () => {
    expect(write(badgeDirective.serialize({ label: 'Built', tone: 'success' }))).toBe(
      ':badge[Built]{tone="success"}\n',
    )
    expect(write(badgeDirective.serialize({ label: 'Designed', tone: 'neutral' }))).toBe(
      ':badge[Designed]\n',
    )
  })
})

describe('small', () => {
  it('reads and writes the side comment it holds', () => {
    const node = inline(':small[Drawn from the code on main.]\n')

    expect(smallDirective.parse(node)).toEqual({ children: node.children })
    expect(smallDirective.validate(node)).toEqual([])
    expect(write(smallDirective.serialize(smallDirective.parse(node)))).toBe(
      ':small[Drawn from the code on main.]\n',
    )
  })

  it('warns when it is empty', () => {
    expect(smallDirective.validate(inline('A :small[] here.\n'))).toHaveLength(1)
  })
})

describe('figure', () => {
  it('splits the subject from the paragraphs that caption it', () => {
    const node = container(
      [':::figure', '```mermaid', 'flowchart LR', '```', '', 'First.', '', 'Second.', ':::'].join(
        '\n',
      ),
    )
    const model = figureDirective.parse(node)

    expect(model.subject.map((child) => child.type)).toEqual(['code'])
    expect(model.caption.map((child) => child.type)).toEqual(['paragraph', 'paragraph'])
  })

  it('has no caption when nothing follows the subject', () => {
    const model = figureDirective.parse(container(':::figure\n| a |\n| - |\n:::\n'))

    expect(model.subject.map((child) => child.type)).toEqual(['table'])
    expect(model.caption).toEqual([])
  })

  it('treats a figure of paragraphs alone as all subject', () => {
    const model = figureDirective.parse(container(':::figure\nOnly words.\n:::\n'))

    expect(model.subject.map((child) => child.type)).toEqual(['paragraph'])
    expect(model.caption).toEqual([])
  })

  it('warns about an empty figure and writes a figure back', () => {
    const empty = container(':::figure\n:::\n')
    const full = container(':::figure\n```mermaid\nx\n```\n\nCaption.\n:::\n')

    expect(figureDirective.validate(empty)).toHaveLength(1)
    expect(figureDirective.validate(full)).toEqual([])
    expect(write(figureDirective.serialize(figureDirective.parse(full)))).toBe(
      ':::figure\n```mermaid\nx\n```\n\nCaption.\n:::\n',
    )
  })
})

describe('cards', () => {
  const source = [
    ':::cards{variant=ruled}',
    'An untitled lead.',
    '',
    '### One',
    '',
    'First.',
    '',
    '#### Inside one',
    '',
    '### Two',
    '',
    'Second.',
    ':::',
  ].join('\n')

  it('makes a card of each heading at the shallowest level, and of what leads them', () => {
    const model = cardsDirective.parse(container(source))

    expect(model.variant).toBe('ruled')
    expect(model.cards.map((card) => card.map((child) => child.type))).toEqual([
      ['paragraph'],
      ['heading', 'paragraph', 'heading'],
      ['heading', 'paragraph'],
    ])
  })

  it('is panels by default and warns about an unknown variant', () => {
    const plain = container(':::cards\n### A\n:::\n')
    const odd = container(':::cards{variant=sparkly}\n### A\n:::\n')

    expect(cardsDirective.parse(plain).variant).toBe('panels')
    expect(cardsDirective.parse(odd).variant).toBe('panels')
    expect(cardsDirective.validate(odd)).toEqual([
      {
        path: 'variant',
        message: 'Unknown cards variant "sparkly"; rendered as panels.',
        severity: 'warning',
      },
    ])
    expect(cardsDirective.validate(plain)).toEqual([])
  })

  it('writes back the cards as they were written', () => {
    const node = container(source)

    expect(write(cardsDirective.serialize(cardsDirective.parse(node)))).toBe(
      `${source.replace('{variant=ruled}', '{variant="ruled"}')}\n`,
    )
    expect(write(cardsDirective.serialize({ variant: 'panels', cards: [] }))).toBe(
      ':::cards\n:::\n',
    )
  })
})

describe('the registry', () => {
  it('knows the reading directives', () => {
    expect(findDirective(inline(':badge[x]\n'))).toBe(badgeDirective)
    expect(findDirective(inline(':small[x]\n'))).toBe(smallDirective)
    expect(findDirective(container(':::figure\nx\n:::\n'))).toBe(figureDirective)
    expect(findDirective(container(':::cards\nx\n:::\n'))).toBe(cardsDirective)
  })

  it('reports their problems by position', () => {
    expect(
      validateDirectives(parseMarkdown(':badge[x]{tone=odd}\n\n:::figure\n:::\n')).map(
        (found) => found.path,
      ),
    ).toEqual(['badge[0].tone', 'figure[1]'])
  })
})

describe('badge shorthands', () => {
  it('take their tone from their name and write back the way they were written', () => {
    const node = inline('A :warn[Not read] cell.\n')

    expect(badgeDirective.parse(node)).toEqual({ label: 'Not read', tone: 'warning', name: 'warn' })
    expect(write(badgeDirective.serialize(badgeDirective.parse(node)))).toBe(':warn[Not read]\n')
  })
})

describe("a shorthand that is only the author's text", () => {
  it('raises nothing about status:ok in prose', () => {
    expect(badgeDirective.validate(inline('The check said status:ok here.\n'))).toEqual([])
  })
})
