import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { deflateRawSync, inflateRawSync } from 'node:zlib'

import { describe, expect, it } from 'vitest'

import type { DrawioLimits, Inflate } from './drawio-file.ts'
import {
  DRAWIO_LIMITS,
  decodeEntities,
  drawioSourceOf,
  editableDrawioSource,
  labelsOfModel,
  readDrawioLabels,
  readDrawioModels,
} from './drawio-file.ts'

const read = (path: string): string =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

/** The diagram draw.io 32 saved with SVG text labels, which the corpus shows. */
const SVG_TEXT = read('../../../corpus/25-drawio-diagram.drawio.svg')
/** The same diagram saved with draw.io's default HTML labels. */
const HTML_LABELS = read('./fixtures/html-labels.drawio.svg')

/** The adapter the server uses, in miniature: zlib with its own output cap. */
const inflate: Inflate = async (bytes, maxBytes) => {
  try {
    return {
      kind: 'inflated',
      bytes: inflateRawSync(bytes, { maxOutputLength: Math.max(maxBytes, 1) }),
    }
  } catch (error) {
    const tooLarge = error instanceof RangeError
    return { kind: 'refused', reason: tooLarge ? 'too-large' : 'malformed' }
  }
}

/** draw.io's storage form: URI-encoded, raw deflate, base64. */
function compress(model: string): string {
  return deflateRawSync(Buffer.from(encodeURIComponent(model))).toString('base64')
}

const model = (cells: string): string =>
  `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel>`

const page = (body: string, name = 'Page-1'): string =>
  `<diagram id="${name}" name="${name}">${body}</diagram>`

const mxfile = (...pages: string[]): string => `<mxfile host="test">${pages.join('')}</mxfile>`

const shape = (id: string, value: string, style = 'rounded=1;html=1;'): string =>
  `<mxCell id="${id}" value="${value}" style="${style}" vertex="1" parent="1"><mxGeometry as="geometry"/></mxCell>`

describe('drawioSourceOf', () => {
  it('reads the diagram source out of a .drawio.svg', () => {
    expect(drawioSourceOf(SVG_TEXT)).toMatch(/^<mxfile host="localhost"><diagram id="p1"/)
  })

  it('takes a raw .drawio file as its own source', () => {
    const file = `<?xml version="1.0"?>\n${mxfile(page(model('')))}`
    expect(drawioSourceOf(file)).toBe(file)
  })

  it('finds nothing in an SVG draw.io did not write', () => {
    expect(drawioSourceOf('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>')).toBeNull()
    expect(drawioSourceOf('<svg content="hello"><rect/></svg>')).toBeNull()
    expect(drawioSourceOf('<p>not a drawing</p>')).toBeNull()
  })
})

describe('readDrawioLabels', () => {
  it('reads the words of a diagram draw.io compressed', async () => {
    expect(await readDrawioLabels(SVG_TEXT, inflate)).toEqual({
      kind: 'labels',
      labels: ['Browser', 'Quill server', 'request'],
    })
  })

  it('reads the same words whether labels were saved as HTML or SVG text', async () => {
    expect(await readDrawioLabels(HTML_LABELS, inflate)).toEqual(
      await readDrawioLabels(SVG_TEXT, inflate),
    )
  })

  it('reads every page, written out or compressed', async () => {
    const file = mxfile(
      page(model(shape('a', 'Gateway')), 'one'),
      page(compress(model(shape('b', 'Ledger'))), 'two'),
    )
    expect(await readDrawioLabels(file, inflate)).toEqual({
      kind: 'labels',
      labels: ['Gateway', 'Ledger'],
    })
  })

  it('reads a cell with properties by its label, and skips cells without words', async () => {
    const cells =
      '<object label="Payments &amp;amp; refunds" id="p" owner="ops"><mxCell vertex="1" parent="1"/></object>' +
      '<UserObject label="Docs" id="d"><mxCell vertex="1" parent="1"/></UserObject>' +
      shape('empty', '')
    expect(await readDrawioLabels(mxfile(page(model(cells))), inflate)).toEqual({
      kind: 'labels',
      labels: ['Payments & refunds', 'Docs'],
    })
  })

  it('says a file without a diagram is not one', async () => {
    expect(await readDrawioLabels('<svg><rect/></svg>', inflate)).toEqual({ kind: 'not-drawio' })
  })
})

describe('labelsOfModel', () => {
  it('reads an HTML label as words, breaks as spaces and markup removed', () => {
    const value = '&lt;b&gt;Quill&lt;/b&gt;&lt;br&gt;server &amp;amp;&amp;nbsp;cache'
    expect(labelsOfModel(model(shape('a', value)))).toEqual(['Quill server & cache'])
  })

  it('is not ended early by a > inside a quoted value', () => {
    expect(labelsOfModel(model(shape('a', 'a > b')))).toEqual(['a > b'])
  })

  it('reads single-quoted attributes too', () => {
    expect(labelsOfModel("<mxCell id='a' value='Edge words' edge='1'/>")).toEqual(['Edge words'])
  })
})

describe('the limits, against hostile files', () => {
  const tight: DrawioLimits = {
    maxInflatedBytes: 4096,
    maxElements: 50,
    maxPages: 3,
    maxLabelCharacters: 20,
  }

  it('refuses a zip bomb at the cap, without inflating past it', async () => {
    // Two megabytes of one letter compress to about two kilobytes.
    const bomb = deflateRawSync(Buffer.from(encodeURIComponent('A'.repeat(2 * 1024 * 1024))))
    expect(bomb.length).toBeLessThan(4096)
    const asked: number[] = []
    const watching: Inflate = async (bytes, maxBytes) => {
      asked.push(maxBytes)
      return inflate(bytes, maxBytes)
    }
    const file = mxfile(page(bomb.toString('base64')))

    expect(await readDrawioLabels(file, watching, tight)).toEqual({
      kind: 'refused',
      reason: 'too-large',
    })
    expect(asked).toEqual([4096])
  })

  it('shares one budget across pages, so many small bombs are one large one', async () => {
    const third = compress(model(shape('a', 'B'.repeat(1500))))
    const file = mxfile(page(third, 'a'), page(third, 'b'), page(third, 'c'))

    expect(await readDrawioLabels(file, inflate, tight)).toEqual({
      kind: 'refused',
      reason: 'too-large',
    })
  })

  it('refuses a file with more pages than any diagram has', async () => {
    const file = mxfile(...['a', 'b', 'c', 'd'].map((name) => page(model(''), name)))
    expect(await readDrawioLabels(file, inflate, tight)).toEqual({
      kind: 'refused',
      reason: 'too-many-pages',
    })
  })

  it('refuses a model with more elements than the cap', async () => {
    const cells = Array.from({ length: 60 }, (_, index) => shape(`c${index}`, 'x')).join('')
    expect(await readDrawioLabels(mxfile(page(model(cells))), inflate, tight)).toEqual({
      kind: 'refused',
      reason: 'too-many-elements',
    })
  })

  it('keeps at most the label text the cap allows', async () => {
    const cells = shape('a', 'Twelve chars') + shape('b', 'Twelve more!') + shape('c', 'gone')
    expect(await readDrawioLabels(mxfile(page(model(cells))), inflate, tight)).toEqual({
      kind: 'labels',
      labels: ['Twelve chars', 'Twelve m'],
    })
  })

  it('refuses a page that is neither a model nor base64', async () => {
    expect(await readDrawioLabels(mxfile(page('%%% not base64 %%%')), inflate)).toEqual({
      kind: 'refused',
      reason: 'malformed',
    })
  })

  it('refuses a page that inflates to something that was never URI-encoded', async () => {
    const broken = deflateRawSync(Buffer.from('%E0%A4%A')).toString('base64')
    expect(await readDrawioLabels(mxfile(page(broken)), inflate)).toEqual({
      kind: 'refused',
      reason: 'malformed',
    })
  })

  it('refuses a page that is base64 but not deflate', async () => {
    const notDeflate = Buffer.from([0xff, 0xff, 0xff, 0xff]).toString('base64')
    expect(await readDrawioLabels(mxfile(page(notDeflate)), inflate)).toEqual({
      kind: 'refused',
      reason: 'malformed',
    })
  })

  it('scans a pathological tag in linear time', async () => {
    const unterminated = `<mxCell${' a="b"'.repeat(50_000)}`
    const started = performance.now()
    expect(labelsOfModel(unterminated)).toEqual([])
    expect(performance.now() - started).toBeLessThan(1000)
  })

  it('is generous enough for a real diagram', () => {
    expect(DRAWIO_LIMITS.maxInflatedBytes).toBeGreaterThanOrEqual(8 * 1024 * 1024)
    expect(DRAWIO_LIMITS.maxElements).toBeGreaterThanOrEqual(100_000)
  })
})

describe('readDrawioModels', () => {
  it('reads a bare model as one page', async () => {
    const bare = model(shape('a', 'Solo'))
    expect(await readDrawioModels(bare, inflate)).toEqual({ kind: 'models', models: [bare] })
  })

  it('skips an empty page', async () => {
    expect(await readDrawioModels(mxfile('<diagram id="e" name="e"></diagram>'), inflate)).toEqual({
      kind: 'models',
      models: [],
    })
  })

  it('skips a page written as an empty element', async () => {
    expect(await readDrawioModels(mxfile('<diagram id="e" name="e"/>'), inflate)).toEqual({
      kind: 'models',
      models: [],
    })
  })

  it('says a source that is not draw.io is not one', async () => {
    expect(await readDrawioModels('<svg/>', inflate)).toEqual({ kind: 'not-drawio' })
  })
})

describe('editableDrawioSource', () => {
  it('writes every page out, keeping each page’s name', async () => {
    const result = await editableDrawioSource(SVG_TEXT, inflate)
    expect(result.kind).toBe('source')
    const xml = result.kind === 'source' ? result.xml : ''
    expect(xml).toMatch(/^<mxfile host="localhost"><diagram id="p1" name="Page-1"><mxGraphModel/)
    expect(xml).toContain('value="Browser"')
  })

  it('sets every shape and line to write its label as SVG text', async () => {
    const cells =
      shape('a', 'A', 'html=1;convertToSvg=0;') +
      shape('b', 'B', '') +
      '<mxCell id="e" value="E" edge="1" parent="1"/>' +
      shape('c', 'C', 'html=1;convertToSvg=1;')
    const result = await editableDrawioSource(mxfile(page(compress(model(cells)))), inflate)
    const xml = result.kind === 'source' ? result.xml : ''

    expect(xml).toContain('id="a" value="A" style="html=1;convertToSvg=1;"')
    expect(xml).toContain('id="b" value="B" style="convertToSvg=1;"')
    expect(xml).toContain('<mxCell id="e" value="E" edge="1" parent="1" style="convertToSvg=1;"/>')
    expect(xml).toContain('id="c" value="C" style="html=1;convertToSvg=1;"')
    expect(xml).toContain('<mxCell id="1" parent="0"/>')
  })

  it('keeps a wrapping label wrapping, as draw.io’s own toggle does', async () => {
    const cells =
      shape('w', 'W', 'whiteSpace=wrap;html=1;') +
      shape('k', 'K', 'svgWhiteSpace=wrap;convertToSvg=1;')
    const result = await editableDrawioSource(model(cells), inflate)
    const xml = result.kind === 'source' ? result.xml : ''
    expect(xml).toContain('style="whiteSpace=wrap;html=1;convertToSvg=1;svgWhiteSpace=wrap;"')
    expect(xml).toContain('style="convertToSvg=1;svgWhiteSpace=wrap;"')
  })

  it('converts a bare model, and leaves an empty page as it was', async () => {
    const bare = await editableDrawioSource(model(shape('a', 'A', '')), inflate)
    expect(bare).toEqual({
      kind: 'source',
      xml: model(
        '<mxCell id="a" value="A" style="convertToSvg=1;" vertex="1" parent="1"><mxGeometry as="geometry"/></mxCell>',
      ),
      converted: true,
    })
    const empty = mxfile('<diagram id="e" name="e"> </diagram>')
    expect(await editableDrawioSource(empty, inflate)).toEqual({
      kind: 'source',
      xml: empty,
      converted: false,
    })
  })

  it('converts a shape that has no style at all', async () => {
    const bare = model('<mxCell id="a" value="A" vertex="1" parent="1"/>')
    expect(await editableDrawioSource(bare, inflate)).toEqual({
      kind: 'source',
      xml: model('<mxCell id="a" value="A" vertex="1" parent="1" style="convertToSvg=1;"/>'),
      converted: true,
    })
  })

  it('says whether anything needed converting, so a save converts only when it must', async () => {
    const done = shape('a', 'A', 'html=1;convertToSvg=1') + '<mxCell id="2" parent="1"/>'
    expect(await editableDrawioSource(mxfile(page(compress(model(done)))), inflate)).toMatchObject({
      converted: false,
    })
    expect(await editableDrawioSource(model(done + shape('b', 'B')), inflate)).toMatchObject({
      converted: true,
    })
  })

  it('passes a refusal or a file that is not draw.io through', async () => {
    expect(await editableDrawioSource('<svg/>', inflate)).toEqual({ kind: 'not-drawio' })
    expect(await editableDrawioSource(mxfile(page('%%%')), inflate)).toEqual({
      kind: 'refused',
      reason: 'malformed',
    })
  })
})

describe('decodeEntities', () => {
  it('decodes the XML entities, &nbsp; and numeric references', () => {
    expect(decodeEntities('&lt;a&gt; &amp; &quot;b&quot; &apos;c&apos; &#65;&#x42;&nbsp;')).toBe(
      '<a> & "b" \'c\' AB ',
    )
  })

  it('leaves what it does not know, and references past Unicode, as written', () => {
    expect(decodeEntities('&copy; &#0; &#x110000;')).toBe('&copy; &#0; &#x110000;')
  })
})
