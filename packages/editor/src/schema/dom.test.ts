import { parseDocument } from '@quill/markdown'
import { DOMParser, DOMSerializer } from '@tiptap/pm/model'
import type { Node as PMNode } from '@tiptap/pm/model'
import { describe, expect, it } from 'vitest'

import { documentFromMdast, documentToMdast } from '../document/ast.ts'
import { editorSchema } from './editor-schema.ts'
import { nodeClassName, withDom } from './dom.ts'

/**
 * The DOM is the clipboard. A block the author copies leaves the document as
 * HTML and comes back through the same rules, so every node type has to survive
 * the trip — including the attributes that carry a directive's meaning.
 */

const serializer = DOMSerializer.fromSchema(editorSchema)
const parser = DOMParser.fromSchema(editorSchema)

function throughTheDom(markdown: string): PMNode {
  const { doc } = documentFromMdast(parseDocument(markdown).ast)
  const html = document.createElement('div')
  html.append(serializer.serializeFragment(doc.content))
  return parser.parse(html)
}

function markdownAgain(markdown: string): string {
  return documentToMdast(throughTheDom(markdown))
    .tree.children.map((node) => JSON.stringify(node))
    .join('\n')
}

describe('the DOM the editor gives the schema', () => {
  it('names an element after the node it renders', () => {
    expect(nodeClassName('codeBlock')).toBe('code-block')
    expect(nodeClassName('paragraph')).toBe('paragraph')
  })

  it('gives every node type it renders a way back in', () => {
    const rendered = Object.keys(editorSchema.nodes).filter(
      (name) => editorSchema.nodes[name]?.spec.toDOM !== undefined,
    )
    expect(rendered).not.toContain('doc')
    expect(rendered.length).toBeGreaterThan(20)
  })

  it('carries a heading through the DOM at its level', () => {
    const doc = throughTheDom('### Third level\n')
    expect(doc.firstChild?.type.name).toBe('heading')
    expect(doc.firstChild?.attrs['level']).toBe(3)
  })

  it('carries a layout width through the DOM', () => {
    const doc = throughTheDom(':::wide\nA wide paragraph.\n:::\n')
    expect(doc.firstChild?.attrs['layout']).toBe('wide')
  })

  it('carries a directive and its attributes through the DOM', () => {
    const doc = throughTheDom(':::callout{type="warning"}\nMind the gap.\n:::\n')
    expect(doc.firstChild?.type.name).toBe('containerDirective')
    expect(doc.firstChild?.attrs['name']).toBe('callout')
    expect(doc.firstChild?.attrs['attributes']).toEqual({ type: 'warning' })
  })

  it('keeps front matter and an escape-hatch node whole', () => {
    const doc = throughTheDom('---\ntitle: A\n---\n\nText.\n')
    expect(doc.firstChild?.type.name).toBe('frontMatter')
    expect(doc.firstChild?.attrs['value']).toContain('title: A')
  })

  it('keeps a link, its title and its marks', () => {
    expect(markdownAgain('A [link](/a "T") and `code`.\n')).toContain('"url":"/a"')
    expect(markdownAgain('A [link](/a "T") and `code`.\n')).toContain('"title":"T"')
  })

  it('keeps a table, a code block, an image and a list', () => {
    const source = [
      '| A | B |',
      '| - | - |',
      '| 1 | 2 |',
      '',
      '```ts meta',
      'const a = 1',
      '```',
      '',
      '![alt](/i.png "T")',
      '',
      '- [x] done',
      '- [ ] todo',
      '',
      '---',
      '',
      '> Quoted',
      '',
    ].join('\n')
    const doc = throughTheDom(source)
    const types = doc.children.map((child) => child.type.name)
    expect(types).toEqual([
      'table',
      'codeBlock',
      'paragraph',
      'taskList',
      'horizontalRule',
      'blockquote',
    ])
    expect(markdownAgain(source)).toContain('"meta":"meta"')
  })

  it('keeps footnotes, definitions and raw HTML', () => {
    const source = [
      'Text[^a] and <b>inline</b>.',
      '',
      '<div>block</div>',
      '',
      '[ref]: /r "R"',
      '',
      '[^a]: The note.',
      '',
    ].join('\n')
    const types = throughTheDom(source).children.map((child) => child.type.name)
    expect(types).toContain('htmlBlock')
    expect(types).toContain('definition')
    expect(types).toContain('footnoteDefinition')
  })

  it('understands plain HTML that the editor did not write', () => {
    const html = document.createElement('div')
    html.innerHTML = '<h2>Title</h2><ul><li><p>One</p></li></ul><pre><code>x</code></pre>'
    const doc = parser.parse(html)
    expect(doc.children.map((child) => child.type.name)).toEqual([
      'heading',
      'bulletList',
      'codeBlock',
    ])
  })

  it('leaves an extension it has no DOM for alone', () => {
    const before = withDom([])
    expect(before).toEqual([])
  })
})
