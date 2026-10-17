import { describe, expect, it } from 'vitest'
import type { Code, Root } from 'mdast'

import { parseMarkdown, stringifyMdast } from '../pipeline/processor.ts'
import { mdastToProseMirror } from '../prosemirror/from-mdast.ts'
import { proseMirrorToMdast } from '../prosemirror/to-mdast.ts'
import type { CodeGroup } from './code-group.ts'
import {
  codeGroupDirective,
  codeGroupTabs,
  codeLabel,
  createCodeGroup,
  groupCodeBlocks,
  isCodeGroup,
  syncKeyOf,
} from './code-group.ts'

function groups(tree: Root): CodeGroup[] {
  const found: CodeGroup[] = []
  const walk = (node: { readonly type: string; readonly children?: readonly unknown[] }): void => {
    if (isCodeGroup(node)) found.push(node)
    for (const child of node.children ?? []) walk(child as never)
  }
  walk(tree)
  return found
}

const fence = (lang: string, meta: string, value: string): string =>
  ['```' + lang + (meta === '' ? '' : ` ${meta}`), value, '```'].join('\n')

const VITEPRESS = [
  ':::code-group',
  fence('ts', '[TypeScript]', 'const a = 1'),
  fence('py', '[Python]', 'a = 1'),
  ':::',
  '',
].join('\n')

const SPACED = VITEPRESS.replace(':::code-group', '::: code-group')

const FUMADOCS = [
  fence('ts', 'tab="TypeScript"', 'const a = 1'),
  '',
  fence('py', 'tab="Python"', 'a = 1'),
  '',
].join('\n')

describe('reading a code group', () => {
  it.each([
    ['VitePress, as Quill writes it', VITEPRESS, 'directive'],
    ['VitePress, with the space its documentation writes', SPACED, 'spaced'],
    ['Fumadocs, consecutive fences with a tab attribute', FUMADOCS, 'tabs'],
  ])('reads %s', (_name, source, syntax) => {
    const [group] = groups(parseMarkdown(source))
    expect(group?.syntax).toBe(syntax)
    expect(codeGroupTabs(group ?? createCodeGroup([])).map((tab) => tab.label)).toEqual([
      'TypeScript',
      'Python',
    ])
  })

  it.each([
    ['VitePress', VITEPRESS],
    ['spaced VitePress', SPACED],
    ['Fumadocs', FUMADOCS],
    [
      'spread VitePress',
      VITEPRESS.replaceAll('```\n```', '```\n\n```')
        .replace(':::code-group\n', ':::code-group\n\n')
        .replace('```\n:::', '```\n\n:::'),
    ],
    ['tight Fumadocs', FUMADOCS.replace('```\n\n```', '```\n```')],
    [
      'attributes as written',
      VITEPRESS.replace(':::code-group', ':::code-group{sync=pkg-manager}'),
    ],
    [
      'quoted attributes as written',
      VITEPRESS.replace(':::code-group', ':::code-group{sync="pkg"}'),
    ],
    [
      'a longer fence of colons',
      VITEPRESS.replace(':::code-group', '::::code-group').replace(/:::\n$/u, '::::\n'),
    ],
    [
      'a group inside a callout',
      `::::callout{type="note"}\n${VITEPRESS.replace(/\n$/u, '')}\n::::\n`,
    ],
    [
      'a spaced group inside a callout',
      `::::callout{type="note"}\n${SPACED.replace(/\n$/u, '')}\n::::\n`,
    ],
    [
      'a group in a list item',
      `- Install:\n\n  ${FUMADOCS.trimEnd().replaceAll('\n', '\n  ').replaceAll('\n  \n', '\n\n')}\n`,
    ],
  ])('writes %s back byte for byte', (_name, source) => {
    const tree = parseMarkdown(source)
    expect(groups(tree)).toHaveLength(1)
    expect(stringifyMdast(tree)).toBe(source)
  })

  it.each([
    ['a list item', '1. Install:\n\n   :::code-group\n   ```sh [npm]\n   npm i\n   ```\n   :::\n'],
    ['a quote', '> :::code-group\n> ```sh [npm]\n> npm i\n> ```\n> :::\n'],
  ])('writes a VitePress group in %s back byte for byte', (_name, source) => {
    const tree = parseMarkdown(source)
    expect(groups(tree)[0]?.opening).toBe(':::code-group')
    expect(stringifyMdast(tree)).toBe(source)
  })

  it('keeps every block’s own text exactly, blank first and last lines included', () => {
    const values = [
      '\nfirst line follows a blank one',
      'ends with a blank line\n',
      '  indented\n\n\tand tabbed',
    ]
    const loose = values.map((value, index) => ({
      type: 'code' as const,
      lang: 'sh',
      meta: `[T${index}]`,
      value,
    }))
    const grouped = stringifyMdast({ type: 'root', children: [createCodeGroup(loose)] })
    const [group] = groups(parseMarkdown(grouped))
    expect(group?.children.map((code) => code.value)).toEqual(values)
    // And out again: the same blocks with the group taken away.
    const ungrouped = stringifyMdast({ type: 'root', children: group?.children ?? [] })
    expect(
      parseMarkdown(ungrouped).children.map((node) => ('value' in node ? node.value : '')),
    ).toEqual(values)
  })

  it('reads a sync key, and ignores one that is not a key', () => {
    const [synced] = groups(
      parseMarkdown(VITEPRESS.replace(':::code-group', ':::code-group{sync=pkg-manager}')),
    )
    expect(syncKeyOf(synced ?? createCodeGroup([]))).toBe('pkg-manager')
    const [odd] = groups(
      parseMarkdown(VITEPRESS.replace(':::code-group', ':::code-group{sync="a b"}')),
    )
    expect(syncKeyOf(odd ?? createCodeGroup([]))).toBeUndefined()
    expect(syncKeyOf(createCodeGroup([]))).toBeUndefined()
  })

  it('leaves anything that is not a group of fences exactly as it was', () => {
    for (const source of [
      ':::code-group\nSome prose.\n\n```ts\na\n```\n:::\n',
      ':::code-group[Label]\n```ts\na\n```\n:::\n',
      '::: code-group\n```ts [A]\na\n```\n',
      '::: code-group\n\nSome prose.\n\n:::\n',
      '```ts [TypeScript]\na\n```\n\n```py [Python]\nb\n```\n',
      '::: code-group\n```ts [A]\na\n```\nNot a closing line.\n',
    ]) {
      expect(groups(parseMarkdown(source))).toEqual([])
    }
  })

  it('makes one group of a single Fumadocs tab, and two of two runs', () => {
    const source = `${fence('sh', 'tab="npm"', 'npm i')}\n\nThen:\n\n${FUMADOCS}`
    expect(groups(parseMarkdown(source)).map((group) => group.children.length)).toEqual([1, 2])
  })
})

const block = (lang: string | null, meta: string | null): Code => ({
  type: 'code',
  lang,
  meta,
  value: '',
})

describe('naming a tab', () => {
  it('prefers the label, then the title, then the language, then its place', () => {
    expect(codeLabel(block('ts', '[Node] title="a.ts"'), 0)).toBe('Node')
    expect(codeLabel(block('ts', 'title="a.ts"'), 0)).toBe('a.ts')
    expect(codeLabel(block('ts', null), 0)).toBe('TypeScript')
    expect(codeLabel(block('kotlin', null), 0)).toBe('kotlin')
    expect(codeLabel(block(null, null), 2)).toBe('Code 3')
  })

  it('gives each tab its title only where the title is not already its name', () => {
    const tabs = codeGroupTabs(
      createCodeGroup([block('ts', '[Node] title="a.ts"'), block('ts', 'title="b.ts"')]),
    )
    expect(tabs.map((tab) => [tab.label, tab.title])).toEqual([
      ['Node', 'a.ts'],
      ['b.ts', undefined],
    ])
  })
})

describe('writing a new group', () => {
  it('writes the canonical form: a VitePress code group, tight', () => {
    const group = createCodeGroup([
      { type: 'code', lang: 'ts', meta: '[TypeScript]', value: 'const a = 1' },
      { type: 'code', lang: 'py', meta: '[Python]', value: 'a = 1' },
    ])
    expect(stringifyMdast({ type: 'root', children: [group] })).toBe(VITEPRESS)
  })

  it('writes attributes it was given, quoting only what needs it', () => {
    const group = createCodeGroup([{ type: 'code', lang: 'sh', meta: '[npm]', value: 'npm i' }], {
      sync: 'pkg',
      note: 'a "b"}',
      flag: '',
    })
    expect(stringifyMdast({ type: 'root', children: [group] })).toBe(
      ':::code-group{sync=pkg note="a b" flag}\n```sh [npm]\nnpm i\n```\n:::\n',
    )
  })
})

describe('the code-group directive, where it is not a group', () => {
  it('says why', () => {
    const [node] = parseMarkdown(':::code-group\nProse.\n:::\n').children
    expect(node?.type).toBe('containerDirective')
    expect(codeGroupDirective.validate(node as never)).toEqual([
      expect.objectContaining({ severity: 'warning' }),
    ])
    const [label] = parseMarkdown(':::code-group[Label]\n```ts\na\n```\n:::\n').children
    expect(codeGroupDirective.validate(label as never)).toHaveLength(1)
    expect(
      codeGroupDirective.validate({ type: 'textDirective', name: 'code-group', children: [] }),
    ).toEqual([])
  })
})

describe('a tree that did not come from the parser', () => {
  const code: Code = { type: 'code', lang: 'ts', meta: '[A]', value: 'a' }

  it('is grouped without the positions a parse records', () => {
    const tree = groupCodeBlocks(
      {
        type: 'root',
        children: [
          { type: 'containerDirective', name: 'code-group', children: [code] },
          { type: 'paragraph', children: [{ type: 'text', value: '::: code-group' }] },
          code,
          { type: 'paragraph', children: [{ type: 'text', value: ':::' }] },
        ],
      },
      '',
    )
    expect(groups(tree).map((group) => [group.syntax, group.opening, group.spread])).toEqual([
      ['directive', undefined, false],
      ['spaced', '::: code-group', false],
    ])
  })

  it('writes a spaced group with no opening line as VitePress spaces it', () => {
    const group: CodeGroup = { ...createCodeGroup([code]), syntax: 'spaced' }
    expect(stringifyMdast({ type: 'root', children: [group] })).toBe(
      '::: code-group\n```ts [A]\na\n```\n:::\n',
    )
  })

  it('keeps a callout of plain code and Fumadocs tabs at three colons', () => {
    const source = ':::callout{type="note"}\n```sh\nplain\n```\n\n```ts tab="A"\na\n```\n:::\n'
    const tree = parseMarkdown(source)
    expect(groups(tree)).toHaveLength(1)
    expect(stringifyMdast(tree)).toBe(source)
  })

  it('is not opened by a paragraph that only mentions a group', () => {
    expect(groups(parseMarkdown('::: **code-group**\n```ts\na\n```\n:::\n'))).toEqual([])
  })
})

describe('the editor’s code group', () => {
  it('carries a group across, and writes one made in the editor canonically', () => {
    const made = createCodeGroup([
      { type: 'code', lang: 'ts', meta: '[TypeScript]', value: 'const a = 1' },
      { type: 'code', lang: 'py', meta: '[Python]', value: 'a = 1' },
    ])
    const { doc } = mdastToProseMirror({ type: 'root', children: [made] })
    expect(doc.firstChild?.type.name).toBe('codeGroup')
    expect(doc.firstChild?.childCount).toBe(2)
    expect(stringifyMdast(proseMirrorToMdast(doc).tree)).toBe(VITEPRESS)
  })

  it('keeps the syntax, spacing and opening line a document was written with', () => {
    for (const source of [
      SPACED,
      FUMADOCS,
      VITEPRESS.replace(':::code-group', ':::code-group{sync=x}'),
    ]) {
      const { doc } = mdastToProseMirror(parseMarkdown(source))
      expect(stringifyMdast(proseMirrorToMdast(doc).tree)).toBe(source)
    }
  })
})
