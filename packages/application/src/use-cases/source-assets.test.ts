import { describe, expect, it } from 'vitest'

import { readAssetMap, writeAssetMap } from './source-assets.ts'

describe('the asset map a stored revision keeps', () => {
  it('is written with its paths in order, and read back', () => {
    const text = writeAssetMap(
      new Map([
        ['docs/z.png', 'b'],
        ['diagrams/a.png', 'a'],
      ]),
    )
    expect(text.indexOf('diagrams/a.png')).toBeLessThan(text.indexOf('docs/z.png'))
    expect([...(readAssetMap(text) ?? [])]).toEqual([
      ['diagrams/a.png', 'a'],
      ['docs/z.png', 'b'],
    ])
  })

  it.each(['{', 'null', '7', '{"version":2,"assets":{}}', '{"version":1}'])(
    'reads %s as no map',
    (text) => {
      expect(readAssetMap(text)).toBeNull()
    },
  )

  it('keeps only the entries it can read', () => {
    expect([...(readAssetMap('{"version":1,"assets":{"a.png":"x","b.png":7}}') ?? [])]).toEqual([
      ['a.png', 'x'],
    ])
  })
})
