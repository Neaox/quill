import { describe, expect, it } from 'vitest'

import { LINK_PREVIEW_FAILURES, LINK_PREVIEW_KINDS, LINK_PREVIEW_LAYERS } from './link-preview.ts'

describe('the link preview vocabularies', () => {
  it.each([
    ['kinds', LINK_PREVIEW_KINDS],
    ['layers', LINK_PREVIEW_LAYERS],
    ['failures', LINK_PREVIEW_FAILURES],
  ])('list each of the %s once', (_name, values) => {
    expect(new Set(values).size).toBe(values.length)
  })

  it('names the layers in the order the ADR tries them, connector first', () => {
    expect(LINK_PREVIEW_LAYERS[0]).toBe('connector')
    expect(LINK_PREVIEW_LAYERS.indexOf('oembed')).toBeLessThan(
      LINK_PREVIEW_LAYERS.indexOf('open-graph'),
    )
    expect(LINK_PREVIEW_LAYERS.indexOf('open-graph')).toBeLessThan(
      LINK_PREVIEW_LAYERS.indexOf('page'),
    )
  })

  it('keeps `busy` and `blocked` apart from the failures that describe the link itself', () => {
    expect(LINK_PREVIEW_FAILURES).toEqual(expect.arrayContaining(['blocked', 'busy']))
  })
})
