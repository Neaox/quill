import { describe, expect, it } from 'vitest'

import { createMarkdownRegistry } from '../extensions/registry.ts'
import type { AnyBlock } from './define.ts'
import { blockKind, blockProblems, defineBlock, h } from './define.ts'
import { endpointBlock } from './endpoint.ts'
import { p } from './props.ts'
import {
  BUILT_IN_BLOCK_REGISTRY,
  BUILT_IN_BLOCKS,
  createBlockRegistry,
  isQuillDirective,
} from './registry.ts'
import {
  ROOKWOOD_SHAPED,
  castBlock,
  routeBlock,
  stepBlock,
  termBlock,
  timelineBlock,
} from './test-support.ts'

const block = (overrides: Partial<AnyBlock> = {}): AnyBlock => ({
  ...defineBlock({
    id: 'acme.box',
    version: '1.0.0',
    name: 'box',
    title: 'Box',
    description: 'A box.',
    content: 'blocks',
    props: { tone: p.enum(['a', 'b'], { title: 'Tone' }) },
    render: () => h('div', {}),
  }),
  ...overrides,
})

describe('h', () => {
  it('builds hast, with strings as text and nothing for what is absent', () => {
    expect(
      h('p', { className: ['qb-x'] }, 'a', null, undefined, false, ['b', [h('em', {})]]),
    ).toEqual({
      type: 'element',
      tagName: 'p',
      properties: { className: ['qb-x'] },
      children: [
        { type: 'text', value: 'a' },
        { type: 'text', value: 'b' },
        { type: 'element', tagName: 'em', properties: {}, children: [] },
      ],
    })
  })

  it('cannot carry markup: a string of HTML is text', () => {
    expect(h('span', {}, '<script>x</script>').children).toEqual([
      { type: 'text', value: '<script>x</script>' },
    ])
  })
})

describe('blockKind', () => {
  it('says which directive form a block is written in', () => {
    expect(blockKind(termBlock)).toBe('leaf')
    expect(blockKind(routeBlock)).toBe('text')
    expect(blockKind(castBlock)).toBe('container')
    expect(blockKind(timelineBlock)).toBe('container')
  })
})

describe('blockProblems', () => {
  it('accepts a block that keeps the contract', () => {
    expect(blockProblems(block())).toEqual([])
    expect(ROOKWOOD_SHAPED.flatMap(blockProblems)).toEqual([])
  })

  it('names everything wrong with one that does not', () => {
    expect(
      blockProblems(
        block({
          id: 'Box',
          version: '1',
          name: 'Box',
          title: ' ',
          content: { items: 'Item' },
          props: { 'Bad name': { type: 'string', title: '' } },
          data: ['data-tone'],
        }),
      ),
    ).toEqual([
      'its id "Box" is not dotted lower case',
      'its version "1" is not semver',
      'its name "Box" is not a directive name',
      'it has no title',
      'its items "Item" is not a directive name',
      'its prop "Bad name" is not an attribute name',
      'its prop "Bad name" has no title',
      'its grant names "data-tone", which is not data-qb-*',
    ])
  })

  it('refuses a label on an inline block, whose brackets are its content', () => {
    expect(blockProblems(block({ content: 'inline', label: 'optional' }))).toEqual([
      'an inline block cannot take a label: its brackets are its content',
    ])
  })
})

describe('createBlockRegistry', () => {
  it('installs Quill’s own blocks by default', () => {
    expect(BUILT_IN_BLOCKS.map((each) => each.id)).toEqual([
      'quill.endpoint',
      'quill.timeline',
      'quill.step',
      'quill.cast',
      'quill.checks',
      'quill.route',
    ])
    expect(BUILT_IN_BLOCKS.flatMap(blockProblems)).toEqual([])
    expect(BUILT_IN_BLOCK_REGISTRY.find('endpoint', 'container')).toBe(endpointBlock)
    expect(BUILT_IN_BLOCK_REGISTRY.find('route', 'text')?.id).toBe('quill.route')
    expect(BUILT_IN_BLOCK_REGISTRY.dataAttributes).toEqual(['data-qb-method', 'data-qb-tone'])
  })

  it('finds a block by its name and form', () => {
    const registry = createBlockRegistry(ROOKWOOD_SHAPED)
    expect(registry.find('step', 'container')).toBe(stepBlock)
    expect(registry.find('step', 'leaf')).toBeUndefined()
    expect(registry.find('nothing', 'container')).toBeUndefined()
    expect(registry.named('route')).toBe(routeBlock)
    expect(registry.dataAttributes).toEqual([
      'data-qb-columns',
      'data-qb-icon',
      'data-qb-outside',
      'data-qb-tone',
    ])
  })

  it('refuses a block that breaks the contract, at construction', () => {
    expect(() => createBlockRegistry([block({ version: 'one' })])).toThrow(
      'The block "acme.box" cannot be installed: its version "one" is not semver.',
    )
  })

  it('refuses a name Quill’s own directives already mean', () => {
    expect(() => createBlockRegistry([block({ name: 'details' })])).toThrow(
      '"details" is one of Quill\'s own directives',
    )
    expect(() => createBlockRegistry([block({ name: 'kbd' })])).toThrow('own directives')
  })

  it('refuses two blocks with one name or one id', () => {
    expect(() => createBlockRegistry([block(), block({ id: 'acme.other' })])).toThrow(
      'another block is already called "box"',
    )
    expect(() => createBlockRegistry([block(), block({ name: 'other' })])).toThrow(
      'another block already has the id "acme.box"',
    )
  })

  it('refuses items that are not an installed container block', () => {
    expect(() => createBlockRegistry([timelineBlock])).toThrow(
      'its items "step" are not a container block that is installed',
    )
    expect(() => createBlockRegistry([block({ content: { items: 'route' } }), routeBlock])).toThrow(
      'are not a container block',
    )
  })
})

describe('createMarkdownRegistry', () => {
  it('holds the blocks beside the extensions, and signs both', () => {
    const registry = createMarkdownRegistry([], ROOKWOOD_SHAPED)
    expect(registry.blocks.find('timeline', 'container')).toBe(timelineBlock)
    expect(registry.signature).toBe(
      'test.cast@1.0.0 test.divider@1.0.0 test.route@1.0.0 test.step@1.0.0 test.term@1.0.0 test.timeline@1.0.0',
    )
  })
})

describe('isQuillDirective', () => {
  it('names the directives no block may claim', () => {
    expect(isQuillDirective('details')).toBe(true)
    expect(isQuillDirective('endpoint')).toBe(false)
  })
})
