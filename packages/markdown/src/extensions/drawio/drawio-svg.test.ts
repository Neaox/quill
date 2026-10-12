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

const URL_ = '/api/attachments/3c9e1f4a-7b2d-4e8f-a1c6-5d0b9e2f8a17'
const registry = createMarkdownRegistry([drawioExtension])

const render = (markup: string, markdown = CORPUS): string =>
  renderHtml(parseMarkdown(markdown), { drawings: new Map([[URL_, markup]]), extensions: registry })

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
      `<div class="diagram" data-diagram="svg"><img src="${URL_}" alt="A browser sends a request to the Quill server" loading="lazy" decoding="async" data-drawio-legacy=""></div>`,
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
      renderHtml(parseMarkdown(CORPUS), { drawings: new Map([[URL_, plain]]) }),
    )
  })

  it('renders the same body twice', () => {
    expect(render(SVG_TEXT)).toBe(render(SVG_TEXT))
  })
})
