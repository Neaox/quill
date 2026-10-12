import { describe, expect, it } from 'vitest'

import { parseDocument } from '../pipeline/parse-document.ts'
import { compareDocuments } from './compare.ts'
import { renderComparison } from './render.ts'

const comparison = (before: string, after: string) =>
  compareDocuments(parseDocument(before).ast, parseDocument(after).ast)

describe('a comparison drawn change by change', () => {
  it('draws each change on its own, as the page would draw it', () => {
    const { changes } = renderComparison(
      comparison(
        'Deploy on Monday.\n\nKeep this.\n\nGone entirely now.\n',
        'Deploy on Tuesday.\n\nKeep this.\n',
      ),
      {},
      { patches: true },
    )

    expect(changes.map(({ html }) => html)).toEqual([
      '<article><p data-change="changed">Deploy on ' +
        '<del data-diff="removed"><span data-diff-label="">Removed: </span><span data-diff-char="">Mon</span>day</del>' +
        '<ins data-diff="added"><span data-diff-label="">Added: </span><span data-diff-char="">Tues</span>day</ins>.</p></article>',
      expect.stringContaining('<p data-change="removed"><del data-diff="removed">'),
    ])
  })

  it('draws both versions of a picture, each saying which it is', () => {
    const { changes } = renderComparison(
      comparison(
        '![Queue architecture overview](/a.png)\n',
        '![Queue architecture overview](/b.png)\n',
      ),
      {},
      { patches: true },
    )

    expect(changes[0]?.html).toContain('data-side="before"')
    expect(changes[0]?.html).toContain('data-side="after"')
  })

  it('is left out unless asked for, which is most of the answer’s size', () => {
    const { changes } = renderComparison(comparison('One here.\n', 'Two here.\n'))

    expect(changes.map((change) => 'html' in change)).toEqual([false])
  })
})
