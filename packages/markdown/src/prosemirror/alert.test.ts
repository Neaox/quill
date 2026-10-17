import type { Blockquote, Root } from 'mdast'
import { describe, expect, it } from 'vitest'

import { parseDocument } from '../pipeline/parse-document.ts'
import { serializeDocument } from '../pipeline/serialize-document.ts'
import {
  ALERT_TYPES,
  alertForm,
  alertType,
  isAlertType,
  readAlert,
  retypeAlert,
  writeAlert,
} from './alert.ts'
import { mdastToProseMirror } from './from-mdast.ts'
import { liftLayout, wrapLayout } from './layout.ts'
import { schema } from './schema.ts'
import { proseMirrorToMdast } from './to-mdast.ts'

/**
 * A GitHub alert in the editor is a quote that knows it is one (`alert.ts`):
 * the marker line is carried on the quote rather than in its text, so the
 * author sees a callout and not `[!NOTE]`, and the marker comes back on the
 * way out exactly as it was written.
 */

function quoteOf(markdown: string): Blockquote {
  const [first] = parseDocument(markdown).ast.children
  if (first?.type !== 'blockquote') throw new Error('Expected a quote.')
  return first
}

function load(markdown: string, softBreaks: 'preserve' | 'collapse' = 'collapse') {
  return mdastToProseMirror(parseDocument(markdown).ast, { softBreaks }).doc
}

function save(doc: ReturnType<typeof load>): string {
  return serializeDocument({ frontMatter: {}, ast: proseMirrorToMdast(wrapLayout(doc)).tree })
}

function throughTheEditor(markdown: string): string {
  return save(liftLayout(load(markdown)))
}

describe('reading an alert', () => {
  it('takes the marker line off the text, keeping it as written', () => {
    const doc = load('> [!Warning]\n> Mind the gap.\n')
    const quote = doc.child(0)
    expect(quote.attrs['alert']).toEqual({ marker: '[!Warning]\n', alone: false })
    expect(quote.textContent).toBe('Mind the gap.')
  })

  it('knows a marker that was a paragraph of its own', () => {
    const doc = load('> [!NOTE]\n>\n> Body.\n')
    expect(doc.child(0).attrs['alert']).toEqual({ marker: '[!NOTE]', alone: true })
    expect(doc.child(0).childCount).toBe(1)
    expect(doc.child(0).textContent).toBe('Body.')
  })

  it('holds an empty line when the alert has nothing but its marker', () => {
    const quote = load('> [!TIP]\n').child(0)
    expect(quote.attrs['alert']).toEqual({ marker: '[!TIP]', alone: true })
    expect(quote.child(0).attrs['synthetic']).toBe(true)
  })

  it('keeps a body that opens with formatting, or with a hard break', () => {
    expect(load('> [!NOTE]\n> **Bold** body.\n').child(0).attrs['alert']).toEqual({
      marker: '[!NOTE]\n',
      alone: false,
    })
    const broken = load('> [!NOTE]\\\n> body.\n', 'preserve').child(0)
    expect(broken.attrs['alert']).toEqual({ marker: '[!NOTE]', alone: false })
    expect(broken.child(0).child(0).type.name).toBe('hardBreak')
  })

  it('leaves an ordinary quote, and a marker with words after it, alone', () => {
    expect(load('> Just a quote.\n').child(0).attrs['alert']).toBeNull()
    expect(load('> [!NOTE] Not an alert.\n').child(0).attrs['alert']).toBeNull()
    expect(readAlert(quoteOf('> Plain.\n'))).toBeUndefined()
  })
})

describe('writing an alert back', () => {
  const sources = [
    '> [!NOTE]\n> Body.\n',
    '> [!important]\n> Lower case.\n',
    '> [!Caution]\n> Capitalised.\n',
    '> [!NOTE]\n>\n> Body after a gap.\n',
    '> [!TIP]\n',
    '> [!WARNING]\n> **Bold** first.\n',
    '> [!NOTE]\n> One.\n>\n> - two\n> - three\n',
    '- An item.\n\n  > [!NOTE]\n  > Inside a list.\n',
    '> [!NOTE]\n>\n> > Quoted.\n',
  ]

  it.each(sources)('keeps %j byte for byte', (source) => {
    expect(throughTheEditor(source)).toBe(source)
  })

  it('keeps a hard break straight after the marker', () => {
    const source = '> [!NOTE]\\\n> body.\n'
    expect(save(load(source, 'preserve'))).toBe(source)
  })

  it('writes the marker alone when the author empties the first line', () => {
    const doc = load('> [!NOTE]\n> Body.\n')
    const quote = doc.child(0)
    const emptied = doc.replace(2, 2 + quote.child(0).content.size, doc.slice(0, 0))
    expect(save(emptied)).toBe('> [!NOTE]\n')
  })

  it('writes an ordinary quote as one', () => {
    expect(throughTheEditor('> Plain words.\n')).toBe('> Plain words.\n')
  })

  it('puts the marker on a line of its own before a body that is not a paragraph', () => {
    const list = parseDocument('- one\n').ast.children.flatMap((child) =>
      child.type === 'list' ? [child] : [],
    )
    const children = writeAlert(list, { marker: '[!NOTE]\n', alone: false })
    const tree: Root = { type: 'root', children: [{ type: 'blockquote', children }] }
    expect(serializeDocument({ frontMatter: {}, ast: tree })).toBe('> [!NOTE]\n>\n> - one\n')
  })
})

describe('a marker written before a hard break whose break has gone', () => {
  it('gets a line ending of its own, so the body stays below it', () => {
    const paragraph = parseDocument('Body.\n').ast.children.flatMap((child) =>
      child.type === 'paragraph' ? [child] : [],
    )
    const children = writeAlert(paragraph, { marker: '[!NOTE]', alone: false })
    const tree: Root = { type: 'root', children: [{ type: 'blockquote', children }] }
    expect(serializeDocument({ frontMatter: {}, ast: tree })).toBe('> [!NOTE]\n> Body.\n')
  })
})

describe('changing an alert’s type', () => {
  it('changes the word and nothing else, in the case it was written in', () => {
    expect(retypeAlert({ marker: '[!NOTE]\n', alone: false }, 'warning')).toEqual({
      marker: '[!WARNING]\n',
      alone: false,
    })
    expect(retypeAlert({ marker: '[!note]', alone: true }, 'tip').marker).toBe('[!tip]')
    expect(retypeAlert({ marker: '[!Note]\n', alone: false }, 'caution').marker).toBe(
      '[!Caution]\n',
    )
  })

  it('round-trips the new type', () => {
    const doc = load('> [!NOTE]\n> Body.\n')
    const quote = doc.child(0)
    const form = alertForm(quote.attrs['alert'])
    if (form === undefined) throw new Error('Expected an alert.')
    const retyped = schema.node(
      'blockquote',
      { ...quote.attrs, alert: retypeAlert(form, 'important') },
      quote.content,
    )
    expect(save(doc.copy(doc.content.replaceChild(0, retyped)))).toBe('> [!IMPORTANT]\n> Body.\n')
  })

  it('reads the type of a form, and refuses a form that is not one', () => {
    expect(alertType({ marker: '[!Tip]\n', alone: false })).toBe('tip')
    // A form is only made from a marker that names a type; anything else reads as a note.
    expect(alertType({ marker: '[!Aside]', alone: true })).toBe('note')
    expect(alertForm(null)).toBeUndefined()
    expect(alertForm({ marker: 3, alone: true })).toBeUndefined()
    expect(alertForm({ marker: '[!NOPE]', alone: true })).toBeUndefined()
    expect(alertForm({ marker: '[!NOTE]', alone: 'yes' })).toBeUndefined()
    expect(alertForm({ marker: '[!NOTE]', alone: true })).toEqual({
      marker: '[!NOTE]',
      alone: true,
    })
  })

  it('knows GitHub’s five types, which have no Info', () => {
    expect(ALERT_TYPES).toEqual(['note', 'tip', 'important', 'warning', 'caution'])
    expect(isAlertType('info')).toBe(false)
    expect(isAlertType('warning')).toBe(true)
  })
})
