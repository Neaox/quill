import { describe, expect, it } from 'vitest'

import type { Inflate } from './drawio-file.ts'
import { editableDrawioSource, readDrawioLabels, readDrawioModels } from './drawio-file.ts'

/** An adapter for a page that is not deflate at all: it answers with the same bytes whatever it is given. */
const inflatesTo =
  (text: string): Inflate =>
  async () => ({ kind: 'inflated', bytes: new TextEncoder().encode(encodeURIComponent(text)) })

const refuses: Inflate = async () => ({ kind: 'refused', reason: 'malformed' })

const MODEL =
  '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>'

describe('reading a draw.io file whose pages are not all written out', () => {
  it('skips a page that is only a tag', async () => {
    const file = `<mxfile><diagram id="a" name="a"/><diagram id="b" name="b">${MODEL}</diagram></mxfile>`

    expect(await readDrawioModels(file, refuses)).toEqual({ kind: 'models', models: [MODEL] })
  })

  it('finds no words in a page that holds no elements', async () => {
    const file = '<mxfile><diagram id="a" name="a">AAAA</diagram></mxfile>'

    expect(await readDrawioLabels(file, inflatesTo('only words'))).toEqual({
      kind: 'labels',
      labels: [],
    })
  })
})

describe('converting the labels of a diagram to SVG text', () => {
  it('converts a shape that has no style at all', async () => {
    const file = `<mxGraphModel><root><mxCell id="0"/><mxCell id="2" value="A" vertex="1" parent="1"/></root></mxGraphModel>`

    expect(await editableDrawioSource(file, refuses)).toEqual({
      kind: 'source',
      xml: expect.stringContaining('style="convertToSvg=1;"'),
      converted: true,
    })
  })
})
