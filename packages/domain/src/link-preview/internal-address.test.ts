import { describe, expect, it } from 'vitest'

import { internalDocumentAddress, isInternalAddress } from './internal-address.ts'

const ID = '0192f0a4-7c1e-7a3b-8d1e-4a5b6c7d8e9f'

describe('internalDocumentAddress', () => {
  it('names a document by its canonical id address', () => {
    expect(internalDocumentAddress(`/d/${ID}`)).toBe(`/d/${ID}`)
  })

  it('lower-cases an id, so two spellings are one key', () => {
    expect(internalDocumentAddress(`/d/${ID.toUpperCase()}`)).toBe(`/d/${ID}`)
  })

  it('drops the workspace, the fragment and the query', () => {
    expect(internalDocumentAddress(`/w/engineering/d/${ID}?x=1#top`)).toBe(`/d/${ID}`)
  })

  it('keeps a readable reference as written, for the server to resolve', () => {
    expect(internalDocumentAddress('/d/the-title-k7m3q9v2xd')).toBe('/d/the-title-k7m3q9v2xd')
  })

  it.each([
    'https://example.com/d/abc',
    '//evil.example/d/abc',
    '/d/',
    '/d/a/b',
    '/x/d/abc',
    'd/abc',
    '/d/<script>',
    '',
  ])('is not an address for %j', (value) => {
    expect(internalDocumentAddress(value)).toBeNull()
  })

  it('tells an internal key from an external one', () => {
    expect(isInternalAddress(`/d/${ID}`)).toBe(true)
    expect(isInternalAddress('https://example.com/')).toBe(false)
  })
})
