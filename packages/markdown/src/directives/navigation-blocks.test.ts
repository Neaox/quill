import { describe, expect, it } from 'vitest'
import type { LeafDirective } from 'mdast-util-directive'

import { parseMarkdown, stringifyMdast } from '../pipeline/processor.ts'
import { integerAttribute, integerIssues } from './definition.ts'
import { childDepth, childrenDirective } from './children.ts'
import { findDirective } from './registry.ts'
import { tocDirective, tocLevels } from './toc.ts'

function leaf(markdown: string): LeafDirective {
  const found = parseMarkdown(markdown).children.find((node) => node.type === 'leafDirective')
  if (found === undefined) throw new Error(`no leaf directive in ${markdown}`)
  return found
}

function write(node: LeafDirective): string {
  return stringifyMdast({ type: 'root', children: [node] })
}

describe('integer attributes', () => {
  const range = { min: 1, max: 5 }

  it('reads a whole number inside the range', () => {
    expect(integerAttribute(leaf('::x{n=3}\n').attributes, 'n', range)).toBe(3)
  })

  it.each(['0', '6', '2.5', '-1', 'two', ''])('refuses %j', (written) => {
    expect(integerAttribute(leaf(`::x{n="${written}"}\n`).attributes, 'n', range)).toBeUndefined()
  })

  it('is undefined when the attribute is absent, and says nothing about it', () => {
    expect(integerAttribute(leaf('::x\n').attributes, 'n', range)).toBeUndefined()
    expect(integerIssues(leaf('::x\n').attributes, 'n', range)).toEqual([])
  })

  it('reports an attribute that was written but cannot be read', () => {
    expect(integerIssues(leaf('::x{n=9}\n').attributes, 'n', range)).toEqual([
      {
        path: 'n',
        message: '"n" must be a whole number from 1 to 5; found "9".',
        severity: 'warning',
      },
    ])
    expect(integerIssues(leaf('::x{n=2}\n').attributes, 'n', range)).toEqual([])
  })
})

describe('reading attributes without a syntax tree', () => {
  it('reads the levels of a table of contents from a plain record, as the editor holds them', () => {
    expect(tocLevels({ min: '1', max: '4' })).toEqual({ min: 1, max: 4 })
    expect(tocLevels({ min: '5', max: '3' })).toEqual({ min: 3, max: 5 })
  })

  it('falls back to the defaults when there are no attributes at all', () => {
    expect(tocLevels(undefined)).toEqual({ min: 2, max: 3 })
    expect(tocLevels(null)).toEqual({ min: 2, max: 3 })
    expect(childDepth(undefined)).toBe(1)
    expect(childDepth(null)).toBe(1)
    expect(childDepth({ depth: '4' })).toBe(4)
  })
})

describe('toc', () => {
  it('lists the sections under the title by default', () => {
    expect(tocDirective.parse(leaf('::toc\n'))).toEqual({ min: 2, max: 3 })
  })

  it('reads the levels it is given', () => {
    expect(tocDirective.parse(leaf('::toc{min=1 max=4}\n'))).toEqual({ min: 1, max: 4 })
    expect(tocDirective.parse(leaf('::toc{max=6}\n'))).toEqual({ min: 2, max: 6 })
  })

  it('reads a range written the wrong way round the right way round', () => {
    expect(tocDirective.parse(leaf('::toc{min=4 max=2}\n'))).toEqual({ min: 2, max: 4 })
  })

  it('falls back to the defaults for levels HTML does not have', () => {
    expect(tocDirective.parse(leaf('::toc{min=0 max=7}\n'))).toEqual({ min: 2, max: 3 })
    expect(tocDirective.parse(leaf('::toc{min=two max=1.5}\n'))).toEqual({ min: 2, max: 3 })
  })

  it('warns about a level it cannot read, and about a reversed range', () => {
    const paths = (source: string) => tocDirective.validate(leaf(source)).map((found) => found.path)
    expect(paths('::toc{min=2 max=3}\n')).toEqual([])
    expect(paths('::toc\n')).toEqual([])
    expect(paths('::toc{max=9}\n')).toEqual(['max'])
    expect(paths('::toc{min=x}\n')).toEqual(['min'])
    expect(paths('::toc{min=4 max=2}\n')).toEqual(['min'])
  })

  it('writes back as a leaf directive', () => {
    expect(write(tocDirective.serialize({ min: 2, max: 4 }))).toBe('::toc{min="2" max="4"}\n')
  })

  it('is found by the registry', () => {
    expect(findDirective(leaf('::toc\n'))).toBe(tocDirective)
  })
})

describe('children', () => {
  it('lists the direct children by default', () => {
    expect(childrenDirective.parse(leaf('::children\n'))).toEqual({ depth: 1 })
  })

  it('reads the depth it is given', () => {
    expect(childrenDirective.parse(leaf('::children{depth=3}\n'))).toEqual({ depth: 3 })
  })

  it('falls back to the default for a depth it cannot list', () => {
    for (const depth of ['0', '9', 'deep']) {
      expect(childrenDirective.parse(leaf(`::children{depth=${depth}}\n`))).toEqual({ depth: 1 })
    }
  })

  it('warns about a depth it cannot read', () => {
    expect(childrenDirective.validate(leaf('::children{depth=2}\n'))).toEqual([])
    expect(childrenDirective.validate(leaf('::children\n'))).toEqual([])
    expect(childrenDirective.validate(leaf('::children{depth=9}\n'))).toHaveLength(1)
  })

  it('writes back as a leaf directive', () => {
    expect(write(childrenDirective.serialize({ depth: 2 }))).toBe('::children{depth="2"}\n')
  })

  it('is found by the registry', () => {
    expect(findDirective(leaf('::children\n'))).toBe(childrenDirective)
  })
})
