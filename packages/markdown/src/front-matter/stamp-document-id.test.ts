import { describe, expect, it } from 'vitest'

import { stampDocumentId } from './stamp-document-id.ts'

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e'

describe('stampDocumentId', () => {
  it('gives a file with no front matter a block holding only the id', () => {
    expect(stampDocumentId('# Setup\n\nRun it.\n', ID)).toBe(
      `---\nid: ${ID}\n---\n# Setup\n\nRun it.\n`,
    )
  })

  it('puts the id first and keeps every other key exactly as written', () => {
    const source = "---\ntitle: 'Setup'   # shown in the tree\ntags: [a, b]\n---\nBody\n"
    expect(stampDocumentId(source, ID)).toBe(
      `---\nid: ${ID}\ntitle: 'Setup'   # shown in the tree\ntags: [a, b]\n---\nBody\n`,
    )
  })

  it("replaces the file's own id, so a copied file cannot claim another identity", () => {
    const source =
      '---\ntitle: Setup\nid: 11111111-1111-4111-8111-111111111111 # copied\nowner: ada\n---\nBody\n'
    expect(stampDocumentId(source, ID)).toBe(
      `---\nid: ${ID}\ntitle: Setup\nowner: ada\n---\nBody\n`,
    )
  })

  it('removes an id whose value spans several lines', () => {
    const source = '---\nid: |\n  one\n  two\ntitle: T\n---\n'
    expect(stampDocumentId(source, ID)).toBe(`---\nid: ${ID}\ntitle: T\n---\n`)
  })

  it('removes an id with no value', () => {
    expect(stampDocumentId('---\ntitle: T\nid:\n---\nx', ID)).toBe(
      `---\nid: ${ID}\ntitle: T\n---\nx`,
    )
  })

  it('removes an explicit id key with no value', () => {
    expect(stampDocumentId('---\n? id\ntitle: T\n---\nx', ID)).toBe(
      `---\nid: ${ID}\ntitle: T\n---\nx`,
    )
    expect(stampDocumentId('---\ntitle: T\n? id\n---\nx', ID)).toBe(
      `---\nid: ${ID}\ntitle: T\n---\nx`,
    )
  })

  it('leaves an empty block holding only the id', () => {
    expect(stampDocumentId('---\n---\nBody', ID)).toBe(`---\nid: ${ID}\n---\nBody`)
    expect(stampDocumentId(`---\nid: x\n---\nBody`, ID)).toBe(`---\nid: ${ID}\n---\nBody`)
  })

  it('keeps a block of only comments', () => {
    expect(stampDocumentId('---\n# nothing yet\n---\nBody', ID)).toBe(
      `---\nid: ${ID}\n# nothing yet\n---\nBody`,
    )
  })

  it('keeps front matter that does not parse, beneath the id the store finds', () => {
    expect(stampDocumentId('---\ntitle: [\n---\nBody', ID)).toBe(
      `---\nid: ${ID}\ntitle: [\n---\nBody`,
    )
    expect(stampDocumentId('---\n- a\n---\nBody', ID)).toBe(`---\nid: ${ID}\n- a\n---\nBody`)
  })

  it('rewrites a flow mapping as a block, which the id line can sit above', () => {
    expect(stampDocumentId('---\n{ id: x, title: T }\n---\nBody', ID)).toBe(
      `---\nid: ${ID}\ntitle: T\n---\nBody`,
    )
    expect(stampDocumentId('---\n{ id: x }\n---\nBody', ID)).toBe(`---\nid: ${ID}\n---\nBody`)
  })

  it('reads Windows line endings and keeps the body as it was', () => {
    expect(stampDocumentId('---\r\ntitle: T\r\n---\r\nBody\r\n', ID)).toBe(
      `---\nid: ${ID}\ntitle: T\n---\nBody\r\n`,
    )
  })

  it('drops a byte order mark, which would hide the block from the store', () => {
    expect(stampDocumentId('﻿---\ntitle: T\n---\n', ID)).toBe(`---\nid: ${ID}\ntitle: T\n---\n`)
  })

  it('treats an unterminated block as body', () => {
    expect(stampDocumentId('---\ntitle: T\n', ID)).toBe(`---\nid: ${ID}\n---\n---\ntitle: T\n`)
  })
})
