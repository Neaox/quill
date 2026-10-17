import { describe, expect, it } from 'vitest'

import { parseDocument } from '../pipeline/parse-document.ts'
import { renderHtml } from '../render/html.ts'
import { compareDocuments } from './compare.ts'
import { renderComparison } from './render.ts'

function render(before: string, after: string) {
  return renderComparison(compareDocuments(parseDocument(before).ast, parseDocument(after).ast))
}

describe('renderComparison', () => {
  it('draws changed words as ins and del, each announced in words', () => {
    const { html } = render('Deploy on Monday.\n', 'Deploy on Tuesday.\n')
    expect(html).toBe(
      '<article><p data-change="changed" data-change-id="c1">Deploy on ' +
        '<del data-diff="removed"><span data-diff-label="">Removed: </span><span data-diff-char="">Mon</span>day</del>' +
        '<ins data-diff="added"><span data-diff-label="">Added: </span><span data-diff-char="">Tues</span>day</ins>.</p></article>',
    )
  })

  it('marks the place where a character was taken out, on the side that no longer has it', () => {
    const { html } = render('The colour is red.\n', 'The color is red.\n')

    expect(html).toContain('colo<span data-diff-char="">u</span>r</del>')
    expect(html).toContain('colo<span data-diff-char=""></span>r</ins>')
  })

  it('tells a deletion from the document’s own strikethrough', () => {
    const { html } = render('Keep ~~this~~.\n', 'Keep ~~this~~ too.\n')
    expect(html).toContain('<del>this</del>')
    expect(html).toContain('<ins data-diff="added">')
  })

  it('marks whole blocks, keeping each block the grid item it always is', () => {
    const { html } = render('# Title\n\nOld paragraph.\n', '# Title\n\nNew words entirely here.\n')
    expect(html).toContain('<p data-change="removed" data-change-id="c1"><del data-diff="removed">')
    expect(html).toContain('<p data-change="added" data-change-id="c2"><ins data-diff="added">')
  })

  it('marks table rows and list items through the renderer’s own handlers', () => {
    const { html } = render(
      '- one\n- two\n\n| a | b |\n| - | - |\n| 1 | 2 |\n',
      '- one\n- two\n- three\n\n| a | b |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |\n',
    )
    expect(html).toMatch(/<li data-change="added">/)
    expect(html).toMatch(/<tr data-change="added">/)
  })

  it('draws a changed code block by line, with the changed words picked out', () => {
    const { html } = render('```ts\nconst a = 1\n```\n', '```ts\nconst a = 2\n```\n')
    expect(html).toContain(
      '<div class="code-block" data-change="changed" data-change-id="c1"><pre data-diff-code="">',
    )
    expect(html).toContain(
      '<del data-diff="removed" data-line="">const a = <span data-diff-word="">1</span></del>',
    )
  })

  it('shows before and after for a picture', () => {
    const { html } = render('![Plan](/a.png)\n', '![Plan](/b.png)\n')
    const opening = (side: string) =>
      html.match(new RegExp(`<p [^>]*data-side="${side}"[^>]*>`))?.[0]
    expect(opening('before')).toContain('data-change-id="c1"')
    expect(opening('after')).toContain('data-change="changed"')
    expect(opening('after')).not.toContain('data-change-id')
  })

  it('keeps a removed GitHub alert an alert, its words struck through', () => {
    const { html } = render('Keep.\n\n> [!NOTE]\n> Read this first.\n', 'Keep.\n')
    expect(html).toMatch(/<aside[^>]*data-change="removed"/)
    expect(html).toContain(
      '<del data-diff="removed"><span data-diff-label="">Removed: </span>Read this first.</del>',
    )
  })

  it('escapes whatever a removed or added passage says', () => {
    const { html } = render(
      'Safe.\n',
      'Safe <script>alert(1)</script> <img src=x onerror=alert(1)>.\n',
    )
    expect(html).not.toMatch(/<script|<img/)
  })

  it('never lets a document carry the comparison’s attributes', () => {
    const html = renderHtml(parseDocument('A :badge[x]{data-change=added} paragraph.\n').ast)
    expect(html).not.toContain('data-change')
  })

  it('sorts changes into the sections a reader navigates by, and sums them up', () => {
    const result = render(
      '# Guide\n\nIntro.\n\n## Install\n\nRun it.\n\n## Use\n\nUse it.\n',
      '# Guide\n\nIntro.\n\n## Install\n\nRun it twice.\n\n## Use, carefully\n\nUse it.\n\nAnd more.\n',
    )
    expect(result.sections.map((section) => [section.title, section.changes])).toEqual([
      ['Guide', 0],
      ['Install', 1],
      ['Use, carefully', 2],
    ])
    expect(result.changes.map((change) => change.section?.title)).toEqual([
      'Install',
      'Use, carefully',
      'Use, carefully',
    ])
    expect(result.summary).toEqual({
      sections: 2,
      added: 1,
      removed: 0,
      changed: 2,
      moved: 0,
      wordsAdded: 4,
      wordsRemoved: 0,
    })
    // The ids resolve against the HTML they came with.
    for (const section of result.sections) expect(result.html).toContain(`id="${section.id}"`)
  })
})
