import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { parseMarkdown } from '../../pipeline/processor.ts'
import { renderHtml } from '../../render/html.ts'
import { createMarkdownRegistry } from '../registry.ts'
import { drawioExtension, drawioFilename, isDrawioFilename } from './drawio-extension.ts'
import { isDrawioDrawing, renderDrawioDrawing, withoutDrawioSource } from './drawio-svg.ts'

const read = (path: string): string =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

const SVG_TEXT = read('../../../corpus/25-drawio-diagram.drawio.svg')
const HTML_LABELS = read('./fixtures/html-labels.drawio.svg')
const CORPUS = read('../../../corpus/25-drawio-diagram.md')

const ATTACHMENT = '/api/attachments/3c9e1f4a-7b2d-4e8f-a1c6-5d0b9e2f8a17'
const registry = createMarkdownRegistry([drawioExtension])

const render = (markup: string, markdown = CORPUS): string =>
  renderHtml(parseMarkdown(markdown), {
    drawings: new Map([[ATTACHMENT, markup]]),
    extensions: registry,
  })

describe('recognising a draw.io drawing', () => {
  it('claims an SVG that carries a draw.io diagram', () => {
    expect(isDrawioDrawing({ markup: SVG_TEXT })).toBe(true)
    expect(isDrawioDrawing({ markup: HTML_LABELS })).toBe(true)
    expect(
      isDrawioDrawing({ markup: '<svg content="&lt;mxGraphModel&gt;&lt;/mxGraphModel&gt;"/>' }),
    ).toBe(true)
  })

  it('leaves every other SVG to the drawing pipeline', () => {
    expect(isDrawioDrawing({ markup: '<svg viewBox="0 0 1 1"><rect/></svg>' })).toBe(false)
    expect(isDrawioDrawing({ markup: '<svg content="not a diagram"/>' })).toBe(false)
  })

  it('knows a draw.io file by its name', () => {
    expect(isDrawioFilename('flow.drawio.svg')).toBe(true)
    expect(isDrawioFilename('Flow.DRAWIO')).toBe(true)
    expect(isDrawioFilename('flow.svg')).toBe(false)
    expect(isDrawioFilename('flow.drawio.png')).toBe(false)
  })

  it('names a saved diagram after its description', () => {
    expect(drawioFilename('Payments: request flow')).toBe('payments-request-flow.drawio.svg')
    expect(drawioFilename('Café ☕')).toBe('cafe.drawio.svg')
    expect(drawioFilename('')).toBe('diagram.drawio.svg')
    expect(drawioFilename('a'.repeat(59) + ' b')).toBe(`${'a'.repeat(59)}.drawio.svg`)
  })
})

describe('drawing a draw.io diagram', () => {
  it('strips the diagram source before anything parses it', () => {
    expect(withoutDrawioSource(SVG_TEXT)).not.toContain('content=')
    expect(withoutDrawioSource(SVG_TEXT)).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/)
    const rendering = renderDrawioDrawing({ markup: SVG_TEXT })
    expect(rendering.kind === 'inline' && rendering.markup).not.toContain('mxfile')
  })

  it('draws SVG text labels inline, at their own size, with their adaptive colours', () => {
    const html = render(SVG_TEXT)

    expect(html).toContain('<div class="diagram" data-diagram="svg"><svg')
    expect(html).toContain('data-drawio="adaptive"')
    expect(html).toContain('width="342" height="62"')
    expect(html).toContain('role="img" aria-label="A browser sends a request to the Quill server"')
    expect(html).toContain('<tspan>Browser</tspan>')
    expect(html).toContain('fill="light-dark(#ffffff, #121212)"')
    expect(html).toContain('stroke="light-dark(rgb(0, 0, 0), rgb(255, 255, 255))"')
    expect(html).toContain('<figcaption>How a request reaches the server</figcaption>')
  })

  it('never puts the source, the stylesheet or a style attribute on the page', () => {
    const html = render(SVG_TEXT)

    expect(html).not.toContain('content=')
    expect(html).not.toContain('mxfile')
    expect(html).not.toContain('<style')
    expect(html).not.toContain('style=')
    expect(html).not.toContain('pointer-events')
    expect(html).not.toContain('--ge-')
  })

  it('marks a diagram drawn without adaptive colours, for the paper the dark needs', () => {
    const fixed = SVG_TEXT.replaceAll(/ style="[^"]*"/g, '').replace(/<style[\s\S]*?<\/style>/, '')
    expect(render(fixed)).toContain('data-drawio="fixed"')
  })

  it('shows a diagram with HTML labels as an image of the file, marked for re-saving', () => {
    const html = render(HTML_LABELS)

    expect(html).toContain(
      `<div class="diagram" data-diagram="svg"><img src="${ATTACHMENT}" alt="A browser sends a request to the Quill server" loading="lazy" decoding="async" data-drawio-legacy=""></div>`,
    )
    expect(html).not.toContain('foreignObject')
    expect(html).not.toContain('<svg')
  })

  it('shows a diagram with embedded pictures as an image, so they are not lost', () => {
    const withImage = SVG_TEXT.replace('<defs/>', '<defs/><image href="data:image/png;base64,AA"/>')
    expect(render(withImage)).toContain('data-drawio-legacy')
  })

  it('never draws the fallback from an address off this origin', () => {
    const offsite = `![x](https://evil.example/a.svg)\n`
    const html = renderHtml(parseMarkdown(offsite), {
      drawings: new Map([['https://evil.example/a.svg', HTML_LABELS]]),
      extensions: registry,
    })
    expect(html).toBe('<article><p><img src="https://evil.example/a.svg" alt="x"></p></article>')
  })

  it('draws an SVG no extension claims exactly as before', () => {
    const plain = '<svg viewBox="0 0 10 10"><rect class="box" width="5" height="5"/></svg>'
    expect(render(plain)).toBe(
      renderHtml(parseMarkdown(CORPUS), { drawings: new Map([[ATTACHMENT, plain]]) }),
    )
  })

  it('renders the same body twice', () => {
    expect(render(SVG_TEXT)).toBe(render(SVG_TEXT))
  })
})

/**
 * The time budgets below are skipped under coverage (`QUILL_COVERAGE`, set by
 * the root Vitest config), where instrumentation, not the pattern, decides the
 * time; a plain `pnpm test` holds them. A pattern that backtracks without
 * bound still fails there, on the test timeout, because the same input is
 * checked for its answer in a test that always runs.
 */
const UNDER_COVERAGE = process.env['QUILL_COVERAGE'] === '1'

/** How long one call takes, in milliseconds. */
function timed(run: () => unknown): number {
  const started = performance.now()
  run()
  return performance.now() - started
}

describe('a hostile draw.io drawing, in linear time', () => {
  const tags = '<svg '.repeat(20_000)
  const spaces = `<svg><rect fill="var(--ge-adaptive-bg,${' '.repeat(5_000)}"/></svg>`
  const many = `<svg>${'var(--ge-adaptive-bg,x'.repeat(5_000)}</svg>`

  it('finds no source in a file of unclosed root tags, and leaves it as it is', () => {
    expect(isDrawioDrawing({ markup: tags })).toBe(false)
    expect(withoutDrawioSource(tags)).toBe(tags)
  })

  it.skipIf(UNDER_COVERAGE)('looks for it without rescanning the file per tag', () => {
    expect(timed(() => isDrawioDrawing({ markup: tags }))).toBeLessThan(50)
    expect(timed(() => withoutDrawioSource(tags))).toBeLessThan(50)
  })

  it('leaves an adaptive background whose value never closes, or never ends, as it is', () => {
    expect(renderDrawioDrawing({ markup: spaces })).toMatchObject({
      kind: 'inline',
      markup: spaces,
    })
    expect(renderDrawioDrawing({ markup: many })).toMatchObject({ kind: 'inline', markup: many })
  })

  it.skipIf(UNDER_COVERAGE)('reads such a background in linear time', () => {
    expect(timed(() => renderDrawioDrawing({ markup: spaces }))).toBeLessThan(50)
    expect(timed(() => renderDrawioDrawing({ markup: many }))).toBeLessThan(50)
  })

  it('still writes out the adaptive background it always did', () => {
    const rendering = renderDrawioDrawing({
      markup: '<svg content="&lt;mxfile/&gt;"><rect fill="var(--ge-adaptive-bg,  #fff )"/></svg>',
    })

    expect(rendering.kind === 'inline' && rendering.markup).toContain(
      'fill="light-dark(#fff, #121212)"',
    )
    const empty = renderDrawioDrawing({
      markup: '<svg><rect fill="var(--ge-adaptive-bg, )"/></svg>',
    })
    expect(empty.kind === 'inline' && empty.markup).toContain('var(--ge-adaptive-bg, )')
  })
})
