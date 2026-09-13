import { describe, expect, it } from 'vitest'

import {
  DRAFT_CONTENT_VERSION,
  isDocumentTree,
  readDraftContent,
  withDocumentAst,
} from './draft-content.ts'

const TREE = { type: 'root', children: [] }

describe('readDraftContent', () => {
  it('reads a draft written at the version this release understands', () => {
    const content = readDraftContent({
      version: DRAFT_CONTENT_VERSION,
      frontMatter: { title: 'Runbook' },
      ast: TREE,
    })

    expect(content).toEqual({
      version: DRAFT_CONTENT_VERSION,
      frontMatter: { title: 'Runbook' },
      ast: TREE,
    })
  })

  it('refuses a draft written at a version it does not know (ADR-033)', () => {
    expect(readDraftContent({ version: 99, frontMatter: {}, ast: TREE })).toBeNull()
  })

  it.each([
    ['no envelope at all', undefined],
    ['null', null],
    ['a bare tree', TREE],
    ['front matter that is not an object', { version: DRAFT_CONTENT_VERSION, frontMatter: null }],
  ])('refuses %s', (_name, value) => {
    expect(readDraftContent(value)).toBeNull()
  })
})

describe('withDocumentAst', () => {
  it('carries the version and the front matter across an edit that never read them', () => {
    const content = {
      version: DRAFT_CONTENT_VERSION,
      frontMatter: { owners: ['a@b.c'] },
      ast: TREE,
    }
    const next = { type: 'root', children: [{ type: 'paragraph', children: [] }] }

    expect(withDocumentAst(content, next)).toEqual({
      version: DRAFT_CONTENT_VERSION,
      frontMatter: { owners: ['a@b.c'] },
      ast: next,
    })
  })
})

describe('isDocumentTree', () => {
  it('accepts an mdast root', () => {
    expect(isDocumentTree(TREE)).toBe(true)
  })

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a string', 'root'],
    ['an object with another type', { type: 'paragraph' }],
  ])('rejects %s', (_name, value) => {
    expect(isDocumentTree(value)).toBe(false)
  })
})
