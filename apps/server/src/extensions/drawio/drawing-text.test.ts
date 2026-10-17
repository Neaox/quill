import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { deflateRawSync } from 'node:zlib'

import { describe, expect, it } from 'vitest'

import { createDrawioText, zlibInflate } from './drawing-text.ts'

const corpus = readFileSync(
  fileURLToPath(
    new URL(
      '../../../../../packages/markdown/corpus/25-drawio-diagram.drawio.svg',
      import.meta.url,
    ),
  ),
  'utf8',
)

describe('zlibInflate', () => {
  it('inflates raw deflate within the cap', async () => {
    const compressed = deflateRawSync(Buffer.from('hello'))
    const result = await zlibInflate(compressed, 1024)
    expect(result.kind === 'inflated' && Buffer.from(result.bytes).toString()).toBe('hello')
  })

  it('stops a bomb at the cap', async () => {
    const bomb = deflateRawSync(Buffer.alloc(10 * 1024 * 1024))
    expect(await zlibInflate(bomb, 64 * 1024)).toEqual({ kind: 'refused', reason: 'too-large' })
  })

  it('refuses bytes that are not deflate, and asks for at least one byte', async () => {
    expect(await zlibInflate(Uint8Array.from([0xff, 0xff, 0xff]), 1024)).toEqual({
      kind: 'refused',
      reason: 'malformed',
    })
    expect(await zlibInflate(deflateRawSync(Buffer.from('x')), 0)).toMatchObject({
      kind: 'inflated',
    })
  })
})

describe('createDrawioText', () => {
  it('reads a draw.io diagram’s labels, one per line', async () => {
    expect(await createDrawioText().read(corpus)).toBe('Browser\nQuill server\nrequest')
  })

  it('has no words for a drawing without a diagram, or a diagram without labels', async () => {
    const reader = createDrawioText()
    expect(await reader.read('<svg><text>Not draw.io</text></svg>')).toBeNull()
    expect(
      await reader.read('<mxfile><diagram id="a"><mxGraphModel/></diagram></mxfile>'),
    ).toBeNull()
  })
})
