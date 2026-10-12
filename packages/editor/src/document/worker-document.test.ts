import { describe, expect, it } from 'vitest'

import { NamedReferenceInWorker, standInForDocument } from './worker-document.ts'

describe('the stand-in document of the parse worker', () => {
  it('makes an element that refuses to decode, so the page parses instead', () => {
    const scope: { document?: { createElement(tag: string): { innerHTML: string } } } = {}
    standInForDocument(scope)
    const element = scope.document?.createElement('i')
    expect(() => {
      if (element !== undefined) element.innerHTML = '&copy;'
    }).toThrow(NamedReferenceInWorker)
  })

  it('leaves a real document alone', () => {
    const scope = { document: 'real' }
    standInForDocument(scope)
    expect(scope.document).toBe('real')
  })
})
