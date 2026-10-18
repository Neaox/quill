import type { Node as PMNode } from 'prosemirror-model'
import type { Paragraph, Root, RootContent } from 'mdast'
import { describe, expect, it } from 'vitest'

import { parseMarkdown, stringifyMdast } from '../pipeline/processor.ts'
import { mdastToProseMirror } from './from-mdast.ts'
import { schema } from './schema.ts'
import { proseMirrorToMdast } from './to-mdast.ts'

const root = (...children: RootContent[]): Root => ({ type: 'root', children })

const paragraph = (value: string): Paragraph => ({
  type: 'paragraph',
  children: [{ type: 'text', value }],
})

const GITHUB_ALERT = '> [!NOTE]\n> Read this first.\n'

/** The document its one block replaced by a copy of it with other attributes. */
function withAttrs(markdown: string, changes: Readonly<Record<string, unknown>>): PMNode {
  const { doc } = mdastToProseMirror(parseMarkdown(markdown), { softBreaks: 'collapse' })
  const [block] = doc.content.content
  if (block === undefined) throw new Error('No block.')
  return doc.type.create(null, [block.type.create({ ...block.attrs, ...changes }, block.content)])
}

const written = (doc: PMNode): string => stringifyMdast(proseMirrorToMdast(doc).tree)

describe('a callout the editor can no longer write as the quote it was read from', () => {
  it('is written as a quote while its alert and its one kind are intact', () => {
    expect(written(withAttrs(GITHUB_ALERT, {}))).toBe(GITHUB_ALERT)
  })

  it.each([
    ['has attributes that are not an object', { attributes: null }],
    ['has more than a kind', { attributes: { type: 'note', open: '' } }],
    ['has no kind', { attributes: {} }],
    ['has a kind no callout has', { attributes: { type: 'shout' } }],
    ['has an alert that names no marker', { alert: {} }],
    ['has an alert whose marker is not text', { alert: { marker: 3 } }],
    ['has no alert at all', { alert: null }],
  ])('is written as the directive when it %s', (_name, changes) => {
    expect(written(withAttrs(GITHUB_ALERT, changes))).toMatch(/^:::callout/u)
  })
})

describe('a details the editor made', () => {
  it('opens a directive with no attributes, and a details with no source', () => {
    const bare: RootContent = {
      type: 'containerDirective',
      name: 'details',
      children: [paragraph('Body.')],
    }
    const html: RootContent = {
      type: 'details',
      syntax: 'html',
      attributes: {},
      children: [paragraph('Body.')],
    }
    const { doc } = mdastToProseMirror(root(bare, html))
    const [first, second] = doc.content.content

    expect(first?.attrs['attributes']).toEqual({})
    expect(second?.attrs['source']).toBeNull()
    expect(written(doc)).toContain('<details>\n\nBody.\n\n</details>\n')
  })

  it('writes a details given no summary node as one with no summary', () => {
    const details = schema.nodes['details']
    if (details === undefined) throw new Error('No details node.')
    const doc = schema.topNodeType.create(null, [
      details.create({ syntax: 'directive', attributes: {}, source: null }, []),
    ])

    expect(written(doc)).toBe(':::details\n:::\n')
  })
})
