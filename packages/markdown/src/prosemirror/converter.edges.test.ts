import type { Node as PMNode } from 'prosemirror-model'
import type { Paragraph, Root, RootContent } from 'mdast'
import { describe, expect, it } from 'vitest'

import { stringifyMdast } from '../pipeline/processor.ts'
import { mdastToProseMirror } from './from-mdast.ts'
import { proseMirrorToMdast } from './to-mdast.ts'

const root = (...children: RootContent[]): Root => ({ type: 'root', children })

const paragraph = (value: string): Paragraph => ({
  type: 'paragraph',
  children: [{ type: 'text', value }],
})

const written = (doc: PMNode): string => stringifyMdast(proseMirrorToMdast(doc).tree)

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
})
