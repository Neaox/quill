import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { isLabelDirective, unknownLabelWarning } from '../directives/label.ts'
import { validateDirectives } from '../directives/registry.ts'
import { parseMarkdown } from '../pipeline/processor.ts'
import { renderHtml } from './html.ts'

const LABELS: ReadonlySet<string> = new Set(['acme', 'globex'])

const render = (markdown: string, labels: ReadonlySet<string> = LABELS): string =>
  renderHtml(parseMarkdown(markdown), { labels })

const corpus = (file: string): string =>
  readFileSync(fileURLToPath(new URL(`../../corpus/${file}`, import.meta.url)), 'utf8')

describe('tenant labels (ADR-037)', () => {
  it('render a directive the theme names as a badge carrying the label', () => {
    expect(render('Shown on :acme[Acme] today.\n')).toBe(
      '<article><p>Shown on <span class="badge" data-label="acme">Acme</span> today.</p></article>',
    )
  })

  it('leave a name the theme does not define as written, like every unknown directive', () => {
    expect(render('Shown on :initech[Initech]{x=1}.\n')).toBe(
      '<article><p>Shown on :initech[Initech]{x="1"}.</p></article>',
    )
  })

  it('render exactly as before when the renderer is given no labels', () => {
    expect(renderHtml(parseMarkdown(':acme[Acme]\n'))).toBe('<article><p>:acme[Acme]</p></article>')
  })

  it('need words: a bare name is the author’s text', () => {
    expect(render('ratio 3:acme here\n')).toBe('<article><p>ratio 3:acme here</p></article>')
  })

  it('never shadow a built-in, whatever the theme says', () => {
    expect(render(':ok[Built]\n', new Set(['ok']))).toContain(
      '<span class="badge" data-tone="success">Built</span>',
    )
    expect(isLabelDirective('ok', new Set(['ok']))).toBe(false)
    expect(isLabelDirective('kbd', new Set(['kbd']))).toBe(false)
  })

  it('refuse a name of any other shape, even one somebody put in the set', () => {
    expect(render(':Acme[A]\n', new Set(['Acme']))).toBe('<article><p>:Acme[A]</p></article>')
  })

  it('carry only their text, so formatting inside one is the label’s words', () => {
    expect(render(':acme[**Ac**me]\n')).toContain(
      '<span class="badge" data-label="acme">Acme</span>',
    )
  })

  it('open a table cell’s status line, as a badge does', () => {
    expect(render('| a |\n| - |\n| :acme[Acme] :ok[Built] Prices. |\n')).toContain(
      '<td><span class="cell-status"><span class="badge" data-label="acme">Acme</span> <span class="badge" data-tone="success">Built</span></span><span class="cell-detail">Prices.</span></td>',
    )
  })

  it('raise no directive issue: a label is the theme’s, not the document’s', () => {
    expect(validateDirectives(parseMarkdown(':acme[Acme]\n'))).toEqual([])
  })
})

describe('a labelled directive the organisation does not define', () => {
  it('is warned about, with the nearest label when one is near', () => {
    expect(unknownLabelWarning('acm', 'Acme', LABELS)).toBe(
      'Unknown label “acm”; it will show as written. Did you mean acme?',
    )
    expect(unknownLabelWarning('expedia', 'Expedia', LABELS)).toBe(
      'Unknown label “expedia”; it will show as written.',
    )
  })

  it('is not a label, a built-in, bare words, or a name no label could have', () => {
    expect(unknownLabelWarning('acme', 'Acme', LABELS)).toBeUndefined()
    expect(unknownLabelWarning('ok', 'Built', LABELS)).toBeUndefined()
    expect(unknownLabelWarning('acm', ' ', LABELS)).toBeUndefined()
    expect(unknownLabelWarning('Acm', 'Acme', LABELS)).toBeUndefined()
  })
})

describe('the channel coverage corpus document', () => {
  const url = '/api/attachments/6f1d2b0e-5c3a-4b7e-9d21-0a8c4f3e7b19'
  const html = renderHtml(parseMarkdown(corpus('21-tenant-labels.md')), {
    labels: LABELS,
    drawings: new Map([[url, corpus('21-tenant-labels.svg')]]),
  })

  it('draws the labels the theme defines, and leaves the one it does not', () => {
    expect(html.match(/data-label="acme"/g)).toHaveLength(2)
    expect(html.match(/data-label="globex"/g)).toHaveLength(2)
    expect(html).toContain(':initech[Initech]')
  })

  it('keeps the label classes in the drawing, where the theme stylesheet colours them', () => {
    expect(html).toContain('class="box acme"')
    expect(html).toContain('class="send acme"')
    expect(html).toContain('<g class="globex">')
    expect(html).not.toContain('#ff5a5f')
  })
})
