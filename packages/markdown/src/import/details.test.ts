import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Root } from 'mdast'

import { isDetailsNode } from '../details/details.ts'
import { parseMarkdown } from '../pipeline/processor.ts'
import {
  importDetails,
  importMdxAccordions,
  importMkDocsDetails,
  importVitePressDetails,
} from './details.ts'

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`fixtures/${name}`, import.meta.url)), 'utf8')

function countDetails(tree: Root): number {
  let count = 0
  const walk = (node: {
    readonly type: string
    readonly name?: unknown
    readonly children?: readonly unknown[]
  }): void => {
    if (isDetailsNode(node)) count += 1
    for (const child of node.children ?? []) walk(child as never)
  }
  walk(tree)
  return count
}

describe('importing collapsible sections from other platforms', () => {
  it.each([
    ['Material for MkDocs', importMkDocsDetails, 'mkdocs-details.md', 'mkdocs-details.expected.md'],
    ['VitePress', importVitePressDetails, 'vitepress-details.md', 'vitepress-details.expected.md'],
    [
      'Fumadocs and Mintlify',
      importMdxAccordions,
      'mdx-accordions.md',
      'mdx-accordions.expected.md',
    ],
  ])('converts %s into Quill’s details', (_platform, convert, input, expected) => {
    expect(convert(fixture(input))).toBe(fixture(expected))
    expect(importDetails(fixture(input))).toBe(fixture(expected))
  })

  it('writes details Quill reads live', () => {
    expect(countDetails(parseMarkdown(importDetails(fixture('mkdocs-details.md'))))).toBe(4)
    expect(countDetails(parseMarkdown(importDetails(fixture('vitepress-details.md'))))).toBe(4)
    expect(countDetails(parseMarkdown(importDetails(fixture('mdx-accordions.md'))))).toBe(4)
  })

  it('leaves what it cannot convert exactly as written', () => {
    for (const source of [
      '??? note "Empty"\n',
      '??? note "Unindented"\nNot content.\n',
      '::: details Never closed\nText.\n',
      '<Accordion title="Never closed">\nText.\n',
    ]) {
      expect(importDetails(source)).toBe(source)
    }
  })

  it('converts the accordions of a group it cannot convert, and leaves the group as written', () => {
    expect(
      importDetails(
        '<Accordions>\nStray text.\n<Accordion title="A">\nx\n</Accordion>\n</Accordions>\n',
      ),
    ).toBe('<Accordions>\nStray text.\n:::details[A]\nx\n:::\n</Accordions>\n')
  })
})
