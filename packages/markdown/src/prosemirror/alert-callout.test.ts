import type { Node as PMNode } from 'prosemirror-model'
import { describe, expect, it } from 'vitest'

import { parseMarkdown, stringifyMdast } from '../pipeline/processor.ts'
import { mdastToProseMirror } from './from-mdast.ts'
import { proseMirrorToMdast } from './to-mdast.ts'

/**
 * A callout written as a quote (GitHub's `> [!NOTE]`, Obsidian's `> [!tip] Title`)
 * is a callout in the editor and a quote in the Markdown (ADR-036): the author
 * edits a callout, and what is written is still the quote, as they wrote it, so
 * every other parser reads it as one.
 */

function open(markdown: string): PMNode {
  return mdastToProseMirror(parseMarkdown(markdown), { softBreaks: 'collapse' }).doc
}

/** A node's blocks. */
function blocks(node: PMNode): PMNode[] {
  const out: PMNode[] = []
  node.forEach((block) => out.push(block))
  return out
}

/** What the editor saves of a document it opened and did not change. */
function saved(markdown: string): string {
  return stringifyMdast(proseMirrorToMdast(open(markdown)).tree)
}

/** The document with its one callout's attributes changed, written. */
function writtenAs(markdown: string, attributes: Readonly<Record<string, string>>): string {
  const doc = open(markdown)
  const [callout] = blocks(doc)
  if (callout === undefined) throw new Error('No callout.')
  const changed = doc.type.create(null, [
    callout.type.create({ ...callout.attrs, attributes }, callout.content),
  ])
  return stringifyMdast(proseMirrorToMdast(changed).tree)
}

/** The document with some of its one callout's attributes replaced by anything at all, written. */
function writtenWith(markdown: string, replaced: Readonly<Record<string, unknown>>): string {
  const doc = open(markdown)
  const [callout] = blocks(doc)
  if (callout === undefined) throw new Error('No callout.')
  const changed = doc.type.create(null, [
    callout.type.create({ ...callout.attrs, ...replaced }, callout.content),
  ])
  return stringifyMdast(proseMirrorToMdast(changed).tree)
}

/** The document with its one callout given a title, written. */
function writtenTitled(markdown: string, title: string): string {
  const doc = open(markdown)
  const [callout] = blocks(doc)
  const paragraph = callout?.type.schema.nodes['paragraph']
  if (callout === undefined || paragraph === undefined) throw new Error('No callout.')
  const label = paragraph.create({ directiveLabel: true }, callout.type.schema.text(title))
  const titled = doc.type.create(null, [
    callout.type.create(callout.attrs, [label, ...blocks(callout)]),
  ])
  return stringifyMdast(proseMirrorToMdast(titled).tree)
}

describe('an alert in the editor', () => {
  it('is a callout of its kind, with the marker taken out of its text', () => {
    const [callout] = blocks(open('> [!IMPORTANT]\n> Delete every mark.\n'))

    expect(callout?.type.name).toBe('containerDirective')
    expect(callout?.attrs['name']).toBe('callout')
    expect(callout?.attrs['attributes']).toEqual({ type: 'important' })
    expect(callout?.textContent).toBe('Delete every mark.')
  })

  it('is read in any case, as GitHub reads it', () => {
    for (const marker of ['note', 'Note', 'NOTE']) {
      const [callout] = blocks(open(`> [!${marker}]\n> Body.\n`))

      expect(callout?.attrs['attributes']).toEqual({ type: 'note' })
    }
  })

  it('is a callout when the quote is written loosely, as GitHub reads it', () => {
    const [callout] = blocks(open('>[!IMPORTANT]\nDelete every mark.\n'))

    expect(callout?.attrs['name']).toBe('callout')
    expect(callout?.textContent).toBe('Delete every mark.')
  })

  it('is not one when the marker is not first, is not followed by a space, or is inside a word', () => {
    for (const quote of [
      '> [!NOTE]text.\n',
      '> Words first. [!NOTE]\n',
      '> Just a quote.\n',
      '> *[!NOTE]*\n> Body.\n',
    ]) {
      expect(open(quote).child(0).type.name).toBe('blockquote')
    }
  })
})

describe('an Obsidian callout in the editor', () => {
  it('has the rest of its marker line as its title, the first block of the callout', () => {
    const [callout] = blocks(open('> [!tip] Before you begin\n> Read **this** first.\n'))
    const [title, body] = blocks(callout as PMNode)

    expect(callout?.attrs['attributes']).toEqual({ type: 'tip' })
    expect(title?.attrs['directiveLabel']).toBe(true)
    expect(title?.textContent).toBe('Before you begin')
    expect(body?.textContent).toBe('Read this first.')
  })

  it('keeps formatting in its title', () => {
    const [callout] = blocks(open('> [!note] A **bold** title\n> Body.\n'))
    const [title] = blocks(callout as PMNode)

    expect(title?.textContent).toBe('A bold title')
    expect(title?.child(1).marks.map((mark) => mark.type.name)).toEqual(['bold'])
  })

  it('is the callout Quill draws an Obsidian kind as, and a note for a kind nobody knows', () => {
    const type = (marker: string) =>
      blocks(open(`> [!${marker}]\n> Body.\n`))[0]?.attrs['attributes']

    expect(type('faq')).toEqual({ type: 'info' })
    expect(type('BUG')).toEqual({ type: 'caution' })
    expect(type('success')).toEqual({ type: 'tip' })
    expect(type('my-own-kind')).toEqual({ type: 'note' })
  })

  it('has a title and nothing else when that is all there is', () => {
    const [callout] = blocks(open('> [!tip] Just a title\n'))

    expect(callout?.childCount).toBe(1)
    expect(callout?.firstChild?.attrs['directiveLabel']).toBe(true)
  })

  it('is not a callout when a hard break ends the first line, which no title has', () => {
    expect(open('> [!tip] A title\\\n> Body.\n').child(0).type.name).toBe('blockquote')
  })
})

describe('a callout written back as a quote', () => {
  const GITHUB: readonly (readonly [string, string])[] = [
    ['with a body', '> [!NOTE]\n> Read this first.\n'],
    ['with no body', '> [!WARNING]\n'],
    ['in lower case', '> [!tip]\n> Read this first.\n'],
    ['capitalised', '> [!Caution]\n> Read this first.\n'],
    ['with several blocks', '> [!NOTE]\n> One.\n>\n> - two\n> - three\n'],
    ['with a body set apart from its marker', '> [!NOTE]\n>\n> Read this first.\n'],
    ['holding a quote', '> [!NOTE]\n>\n> > Quoted.\n'],
    ['holding code', '> [!TIP]\n>\n> ```js\n> run()\n> ```\n'],
    ['with formatting in the body', '> [!IMPORTANT]\n> Read **this** and `that` first.\n'],
    ['inside a list item', '- An item.\n\n  > [!NOTE]\n  > Read this first.\n'],
    ['inside a quote', '> > [!NOTE]\n> > Read this first.\n'],
    ['beside a quote', '> Just a quote.\n\n> [!NOTE]\n> Read this first.\n'],
  ]

  it.each(GITHUB)('is the alert it was, %s', (_shape, source) => {
    expect(saved(source)).toBe(source)
  })

  const OBSIDIAN: readonly (readonly [string, string])[] = [
    ['with a title and a body', '> [!tip] Before you begin\n> Read this first.\n'],
    ['with a title and nothing else', '> [!tip] Just a title\n'],
    ['with a title and a body set apart from it', '> [!tip] A title\n>\n> Read this first.\n'],
    ['with formatting in its title', '> [!note] A **bold** and `code` title\n> Body.\n'],
    ['of one of Obsidian’s kinds', '> [!faq] Why?\n> Because.\n'],
    ['of one of Obsidian’s kinds, with no title', '> [!bug]\n> Fix it.\n'],
    ['of a kind nobody has heard of', '> [!my-own-kind] Hello\n> Body.\n'],
    ['with several blocks', '> [!tip] A title\n> One.\n>\n> - two\n> - three\n'],
    ['inside a list item', '- An item.\n\n  > [!tip] A title\n  > Body.\n'],
  ]

  it.each(OBSIDIAN)('is the Obsidian callout it was, %s', (_shape, source) => {
    expect(saved(source)).toBe(source)
  })

  it('is written in the usual spacing when it was written loosely', () => {
    expect(saved('>[!IMPORTANT]\nDelete every mark.\n')).toBe(
      '> [!IMPORTANT]\n> Delete every mark.\n',
    )
  })

  it('is written as the kind it has been changed to', () => {
    expect(writtenAs('> [!NOTE]\n> Read this first.\n', { type: 'warning' })).toBe(
      '> [!WARNING]\n> Read this first.\n',
    )
  })

  it('is written in the case its neighbours were when its kind changes', () => {
    expect(writtenAs('> [!Note]\n> Body.\n', { type: 'tip' })).toBe('> [!Tip]\n> Body.\n')
    expect(writtenAs('> [!bug]\n> Body.\n', { type: 'tip' })).toBe('> [!tip]\n> Body.\n')
  })

  it('keeps an Obsidian marker as typed while its type is what it was read as', () => {
    expect(writtenAs('> [!faq] Why?\n> Because.\n', { type: 'info' })).toBe(
      '> [!faq] Why?\n> Because.\n',
    )
    expect(writtenAs('> [!faq] Why?\n> Because.\n', { type: 'warning' })).toBe(
      '> [!warning] Why?\n> Because.\n',
    )
  })

  it('is written as the kind it is changed to, GitHub having it or not', () => {
    expect(writtenAs('> [!NOTE]\n> Read this first.\n', { type: 'info' })).toBe(
      '> [!INFO]\n> Read this first.\n',
    )
  })

  it('is written with its title after the marker when a GitHub alert is given one, as Obsidian writes it', () => {
    expect(writtenTitled('> [!NOTE]\n> Body.\n', 'A title')).toBe('> [!NOTE] A title\n> Body.\n')
  })

  it('stays an Obsidian callout when it is given a title, which Obsidian reads', () => {
    expect(writtenTitled('> [!faq]\n> Because.\n', 'Why?')).toBe('> [!faq] Why?\n> Because.\n')
  })

  it('does not turn a directive callout into a quote', () => {
    expect(saved(':::callout{type=note}\nRead this first.\n:::\n')).toBe(
      ':::callout{type=note}\nRead this first.\n:::\n',
    )
  })
})

describe('a callout that is no longer one a quote can say', () => {
  const NOTE = '> [!NOTE]\n> Read this first.\n'

  it.each([
    ['attributes that are not an object', { attributes: null }],
    ['a form that has lost its marker', { alert: {} }],
    ['no kind', { attributes: {} }],
    ['more to say than a kind', { attributes: { type: 'tip', title: 'Heads up' } }],
    ['a kind that is not a callout kind', { attributes: { type: 'shout' } }],
    ['an attribute that is not a kind', { attributes: { title: 'Heads up' } }],
  ])('is written as the directive when it has %s', (_what, replaced) => {
    expect(writtenWith(NOTE, replaced)).toMatch(/^:::callout/u)
  })
})
