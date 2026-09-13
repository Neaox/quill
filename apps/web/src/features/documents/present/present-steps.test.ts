import { describe, expect, it } from 'vitest'

import type { OutlineEntry } from '../../../lib/api/index.ts'
import { splitSteps } from './present-steps.ts'

function entry(
  id: string,
  depth: number,
  text: string,
  children: OutlineEntry[] = [],
): OutlineEntry {
  return { id, depth, text, children }
}

const BODY = `<article>
<h1 id="failover">Regional failover</h1>
<p>How to move traffic between regions.</p>
<h2 id="steps">Steps</h2>
<p>One.</p>
<div class="layout-wide"><table><tbody><tr><td>eu</td></tr></tbody></table></div>
<h3 id="detail">In detail</h3>
<p>Two.</p>
<h2 id="afterwards">Afterwards</h2>
<p>Tell the on-call engineer.</p>
</article>`

const OUTLINE = [
  entry('failover', 1, 'Regional failover', [
    entry('steps', 2, 'Steps', [entry('detail', 3, 'In detail')]),
    entry('afterwards', 2, 'Afterwards'),
  ]),
]

function split(html: string, outline: readonly OutlineEntry[], title = 'Regional failover') {
  return splitSteps(html, outline, title, globalThis.document)
}

describe('splitSteps', () => {
  it('makes one step of the opening and one of each top-level section', () => {
    expect(split(BODY, OUTLINE).map((step) => [step.id, step.title])).toEqual([
      ['failover', 'Regional failover'],
      ['steps', 'Steps'],
      ['afterwards', 'Afterwards'],
    ])
  })

  it('keeps every block of a section with it, sub-headings included', () => {
    const [, steps] = split(BODY, OUTLINE)

    expect(steps?.html).toContain('id="steps"')
    expect(steps?.html).toContain('id="detail"')
    expect(steps?.html).toContain('Two.')
    expect(steps?.html).not.toContain('id="afterwards"')
  })

  it('hands each step back in the `article` wrapper the body mounter expects', () => {
    for (const step of split(BODY, OUTLINE)) {
      expect(step.html.startsWith('<article>')).toBe(true)
      expect(step.html.endsWith('</article>')).toBe(true)
    }
  })

  it('keeps a breakout block intact, so it still spans the grid it asked for', () => {
    const [, steps] = split(BODY, OUTLINE)

    expect(steps?.html).toContain('class="layout-wide"')
  })

  it('starts at the first section when nothing stands above it', () => {
    const html = '<article><h2 id="steps">Steps</h2><p>One.</p></article>'
    const outline = [entry('steps', 2, 'Steps')]

    expect(split(html, outline).map((step) => step.id)).toEqual(['steps'])
  })

  it('presents a document with no sections as one step', () => {
    const html = '<article><h1 id="note">A note</h1><p>Just this.</p></article>'

    expect(split(html, [entry('note', 1, 'A note')], 'A note')).toEqual([
      { id: 'note', title: 'A note', html },
    ])
  })

  it('names the opening step after the document when the body has no title of its own', () => {
    const html = '<article><p>An introduction.</p><h2 id="steps">Steps</h2></article>'
    const outline = [entry('steps', 2, 'Steps')]

    expect(split(html, outline, 'Regional failover')[0]).toMatchObject({
      title: 'Regional failover',
    })
  })

  it('tolerates a body the renderer did not wrap in an article', () => {
    const html = '<h2 id="steps">Steps</h2><p>One.</p>'

    expect(split(html, [entry('steps', 2, 'Steps')])).toHaveLength(1)
  })

  it('finds a section heading the renderer nested inside a block', () => {
    const html = '<article><section><h2 id="steps">Steps</h2></section><p>One.</p></article>'

    expect(split(html, [entry('steps', 2, 'Steps')])[0]?.html).toContain('One.')
  })

  it('has nothing to present when the body is empty', () => {
    expect(split('', [])).toEqual([])
    expect(split('<article></article>', [])).toEqual([])
  })
})
