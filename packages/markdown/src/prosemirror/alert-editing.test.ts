import { Fragment } from 'prosemirror-model'
import type { Node as PMNode } from 'prosemirror-model'
import { describe, expect, it } from 'vitest'

import { readAlertForm } from '../pipeline/github-alert.ts'
import { parseMarkdown, stringifyMdast } from '../pipeline/processor.ts'
import { mdastToProseMirror } from './from-mdast.ts'
import { proseMirrorToMdast } from './to-mdast.ts'

/**
 * A callout read from a quote, as the author edits it: what is written when its
 * blocks change under it (`alert-callout.test.ts` covers it saved unchanged).
 */

function open(markdown: string, softBreaks: 'preserve' | 'collapse' = 'collapse'): PMNode {
  return mdastToProseMirror(parseMarkdown(markdown), { softBreaks }).doc
}

const written = (doc: PMNode): string => stringifyMdast(proseMirrorToMdast(doc).tree)

/** A node's blocks. */
function blocks(node: PMNode): PMNode[] {
  const out: PMNode[] = []
  node.forEach((block) => out.push(block))
  return out
}

describe('a callout whose first line the author empties', () => {
  it('is written with its marker alone', () => {
    const doc = open('> [!NOTE]\n> Body.\n')
    const callout = doc.child(0)
    const emptied = doc.replace(2, 2 + callout.child(0).content.size, doc.slice(0, 0))

    expect(written(emptied)).toBe('> [!NOTE]\n')
  })

  it('keeps its title when the body goes', () => {
    const doc = open('> [!tip] A title\n> Body.\n')
    const callout = doc.child(0)
    const title = callout.child(0)
    const from = 1 + title.nodeSize + 1
    const emptied = doc.replace(from, from + callout.child(1).content.size, doc.slice(0, 0))

    expect(written(emptied)).toBe('> [!tip] A title\n')
  })
})

describe('a callout whose title the author breaks onto two lines', () => {
  it('is still a callout when it is read back, its words all kept', () => {
    const doc = open('> [!tip] A title\n> Body.\n')
    const callout = doc.child(0)
    const { schema } = doc.type
    const hardBreak = schema.nodes['hardBreak']
    if (hardBreak === undefined) throw new Error('No hard break.')
    const title = callout
      .child(0)
      .copy(Fragment.from([schema.text('One'), hardBreak.create(), schema.text('two')]))
    const broken = doc.copy(
      doc.content.replaceChild(0, callout.copy(callout.content.replaceChild(0, title))),
    )
    const [reread] = blocks(open(written(broken)))

    expect(reread?.attrs['name']).toBe('callout')
    expect(reread?.attrs['attributes']).toEqual({ type: 'tip' })
    expect(reread?.child(0).attrs['directiveLabel']).toBe(true)
    // Written as the directive, whose label is one line, as a title is.
    expect(reread?.child(0).textContent).toBe('One two')
  })
})

describe('a marker followed by a hard break', () => {
  it('is a quote, written back as it was', () => {
    const source = '> [!NOTE]\\n> body.\n'

    expect(open(source, 'preserve').child(0).type.name).toBe('blockquote')
    expect(written(open(source, 'preserve'))).toBe(source)
  })
})

describe('the form a callout was written in', () => {
  it('is read back from the node, and nothing else is', () => {
    expect(readAlertForm({ marker: '[!faq]', own: true })).toEqual({ marker: '[!faq]', own: true })
    expect(readAlertForm({ marker: '[!faq]' })).toEqual({ marker: '[!faq]', own: false })
    expect(readAlertForm(null)).toBeUndefined()
    expect(readAlertForm('[!faq]')).toBeUndefined()
    expect(readAlertForm({ marker: 3 })).toBeUndefined()
  })
})
