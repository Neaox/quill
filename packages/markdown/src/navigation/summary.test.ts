import { describe, expect, it } from 'vitest'

import { parseDocument } from '../pipeline/parse-document.ts'
import { documentIcon, documentSummary, SUMMARY_LIMIT } from './summary.ts'

function summaryOf(markdown: string): string | undefined {
  const { frontMatter, ast } = parseDocument(markdown)
  return documentSummary(ast, frontMatter)
}

describe('documentSummary', () => {
  it('is the description when the document has one', () => {
    expect(summaryOf('---\ndescription: "  How we fail over.  "\n---\n\n# T\n\nFirst.\n')).toBe(
      'How we fail over.',
    )
  })

  it('is otherwise the first paragraph, as plain words', () => {
    expect(summaryOf('# Title\n\n> quoted\n\nThe **first** [paragraph](/d/x).\n\nSecond.\n')).toBe(
      'The first paragraph.',
    )
  })

  it('skips guidance and presenter notes, which are not what the document says', () => {
    expect(
      summaryOf(':::guidance\nWrite here.\n:::\n\n:::notes\nSay this.\n:::\n\nReal words.\n'),
    ).toBe('Real words.')
  })

  it('is cut at a word, with an ellipsis, when long', () => {
    const long = 'word '.repeat(100)
    const summary = summaryOf(`${long}\n`) ?? ''
    expect(summary.length).toBeLessThanOrEqual(SUMMARY_LIMIT + 1)
    expect(summary.endsWith('word…')).toBe(true)
    expect(summaryOf(`${'x'.repeat(400)}\n`)).toBe(`${'x'.repeat(SUMMARY_LIMIT)}…`)
  })

  it('is undefined for a document with nothing to say', () => {
    expect(summaryOf('# Only a title\n')).toBeUndefined()
    expect(summaryOf('---\ndescription: 3\n---\n\n![](/a.png)\n')).toBeUndefined()
  })
})

describe('documentIcon', () => {
  it('is a short icon from front matter, and nothing else', () => {
    expect(documentIcon({ icon: '🚀' })).toBe('🚀')
    expect(documentIcon({ icon: ' 📘 ' })).toBe('📘')
    expect(documentIcon({ icon: '' })).toBeUndefined()
    expect(documentIcon({ icon: 'x'.repeat(17) })).toBeUndefined()
    expect(documentIcon({ icon: 7 })).toBeUndefined()
    expect(documentIcon({})).toBeUndefined()
  })
})

describe('a description with no words in it', () => {
  it('gives way to the first paragraph', () => {
    const { frontMatter, ast } = parseDocument('---\ndescription: "   "\n---\n\nThe words.\n')
    expect(documentSummary(ast, frontMatter)).toBe('The words.')
  })
})
