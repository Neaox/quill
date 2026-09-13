import { describe, expect, it } from 'vitest'

import { frontMatterField, readDocumentId, readTitle } from './document-front-matter.ts'

const ID = '018f4c1e-7c3a-7c1d-9b2e-1f2a3b4c5d6e'
const DOCUMENT = `---\nid: ${ID}\ntitle: Onboarding\n---\n\n# Onboarding\n`

describe('readDocumentId', () => {
  it('reads the id from the front matter', () => {
    expect(readDocumentId(DOCUMENT)).toBe(ID)
  })

  it('reads an id written with Windows line endings', () => {
    expect(readDocumentId(`---\r\nid: ${ID}\r\n---\r\n`)).toBe(ID)
  })

  it('reads a quoted id', () => {
    expect(readDocumentId(`---\nid: "${ID}"\n---\n`)).toBe(ID)
  })

  it('returns null for a document with no front matter', () => {
    expect(readDocumentId('# Just a heading\n')).toBeNull()
  })

  it('returns null for front matter with no id', () => {
    expect(readDocumentId('---\ntitle: Onboarding\n---\n')).toBeNull()
  })

  it('returns null when the id is not a UUID', () => {
    expect(readDocumentId('---\nid: not-a-uuid\n---\n')).toBeNull()
  })

  it('ignores an id that appears after the front matter', () => {
    expect(readDocumentId(`---\ntitle: T\n---\n\nid: ${ID}\n`)).toBeNull()
  })

  it('ignores an id nested inside another mapping', () => {
    expect(readDocumentId(`---\nmeta:\n  id: ${ID}\n---\n`)).toBeNull()
  })

  it('does not scan past the first few kilobytes', () => {
    const padded = `---\n${'x: y\n'.repeat(2000)}id: ${ID}\n---\n`
    expect(readDocumentId(padded)).toBeNull()
  })

  it('fails closed when the front matter is never closed', () => {
    expect(readDocumentId(`---\nid: ${ID}\n\n# Onboarding\n`)).toBeNull()
  })

  it('fails closed when the closing fence is past the scan window', () => {
    const padded = `---\nid: ${ID}\n${'x: y\n'.repeat(2000)}---\n`
    expect(readDocumentId(padded)).toBeNull()
  })
})

describe('readTitle', () => {
  it('reads the title', () => {
    expect(readTitle(DOCUMENT)).toBe('Onboarding')
  })

  it('unquotes a quoted title', () => {
    expect(readTitle("---\ntitle: 'Cost & Größe'\n---\n")).toBe('Cost & Größe')
  })

  it('returns null when there is no title', () => {
    expect(readTitle('---\nid: x\n---\n')).toBeNull()
  })
})

describe('frontMatterField', () => {
  it('does not confuse a longer key with the one asked for', () => {
    expect(frontMatterField('---\nidentifier: 7\n---\n', 'id')).toBeNull()
  })

  it('stops at the closing fence', () => {
    expect(frontMatterField('---\ntitle: T\n---\nstatus: draft\n', 'status')).toBeNull()
  })
})
