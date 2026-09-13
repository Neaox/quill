import { collectionId, documentId, workspaceId } from '@quill/domain'
import { parseMarkdown } from '@quill/markdown'
import type { CoreFrontMatter } from '@quill/markdown'
import { describe, expect, it } from 'vitest'

import { projectIndexableDocument } from './project.ts'

const DOCUMENT_ID = documentId('11111111-1111-4111-8111-111111111111')
const WORKSPACE_ID = workspaceId('22222222-2222-4222-8222-222222222222')
const COLLECTION_ID = collectionId('33333333-3333-4333-8333-333333333333')
const UPDATED_AT = new Date('2026-01-01T00:00:00.000Z')

const MINIMAL_FRONT_MATTER: CoreFrontMatter = { id: DOCUMENT_ID }

function location() {
  return {
    documentId: DOCUMENT_ID,
    workspaceId: WORKSPACE_ID,
    collectionId: COLLECTION_ID,
    path: 'guides/getting-started.md',
    updatedAt: UPDATED_AT,
  }
}

describe('projectIndexableDocument', () => {
  it('prefers the front matter title over an extracted heading', () => {
    const ast = parseMarkdown('# Extracted title\n\nSome body text.')
    const result = projectIndexableDocument({
      ...location(),
      frontMatter: { ...MINIMAL_FRONT_MATTER, title: 'Front matter title' },
      ast,
    })
    expect(result.title).toBe('Front matter title')
  })

  it('falls back to the document’s first heading when front matter has no title', () => {
    const ast = parseMarkdown('# Extracted title\n\nSome body text.')
    const result = projectIndexableDocument({
      ...location(),
      frontMatter: MINIMAL_FRONT_MATTER,
      ast,
    })
    expect(result.title).toBe('Extracted title')
  })

  it('falls back to the path when neither front matter nor content has a title', () => {
    const ast = parseMarkdown('Just a paragraph, no heading.')
    const result = projectIndexableDocument({
      ...location(),
      frontMatter: MINIMAL_FRONT_MATTER,
      ast,
    })
    expect(result.title).toBe('guides/getting-started.md')
  })

  it('flattens the heading tree depth-first with weights by depth', () => {
    const ast = parseMarkdown(
      ['# Title', '', '## First section', '', '### Nested', '', '## Second section'].join('\n'),
    )
    const result = projectIndexableDocument({
      ...location(),
      frontMatter: MINIMAL_FRONT_MATTER,
      ast,
    })
    expect(result.headings).toEqual([
      { text: 'Title', depth: 1, weight: 6 },
      { text: 'First section', depth: 2, weight: 5 },
      { text: 'Nested', depth: 3, weight: 4 },
      { text: 'Second section', depth: 2, weight: 5 },
    ])
  })

  it('carries the body text extracted from prose, excluding headings', () => {
    const ast = parseMarkdown('# Title\n\nThe body paragraph.')
    const result = projectIndexableDocument({
      ...location(),
      frontMatter: MINIMAL_FRONT_MATTER,
      ast,
    })
    expect(result.body).toBe('The body paragraph.')
  })

  it('defaults tags and owners to empty arrays when front matter omits them', () => {
    const ast = parseMarkdown('# Title')
    const result = projectIndexableDocument({
      ...location(),
      frontMatter: MINIMAL_FRONT_MATTER,
      ast,
    })
    expect(result.tags).toEqual([])
    expect(result.owners).toEqual([])
  })

  it('carries tags and owners from front matter when present', () => {
    const ast = parseMarkdown('# Title')
    const result = projectIndexableDocument({
      ...location(),
      frontMatter: { ...MINIMAL_FRONT_MATTER, tags: ['release'], owners: ['jane@example.com'] },
      ast,
    })
    expect(result.tags).toEqual(['release'])
    expect(result.owners).toEqual(['jane@example.com'])
  })

  it('defaults status to published when front matter omits it', () => {
    const ast = parseMarkdown('# Title')
    const result = projectIndexableDocument({
      ...location(),
      frontMatter: MINIMAL_FRONT_MATTER,
      ast,
    })
    expect(result.status).toBe('published')
  })

  it('carries status from front matter when present', () => {
    const ast = parseMarkdown('# Title')
    const result = projectIndexableDocument({
      ...location(),
      frontMatter: { ...MINIMAL_FRONT_MATTER, status: 'archived' },
      ast,
    })
    expect(result.status).toBe('archived')
  })

  it('carries the document’s identity, placement, and version', () => {
    const ast = parseMarkdown('# Title')
    const result = projectIndexableDocument({
      ...location(),
      frontMatter: MINIMAL_FRONT_MATTER,
      ast,
    })
    expect(result.version).toBe(1)
    expect(result.documentId).toBe(DOCUMENT_ID)
    expect(result.workspaceId).toBe(WORKSPACE_ID)
    expect(result.collectionId).toBe(COLLECTION_ID)
    expect(result.path).toBe('guides/getting-started.md')
    expect(result.updatedAt).toBe(UPDATED_AT)
  })

  it('carries a null collection for a document filed at the workspace root', () => {
    const ast = parseMarkdown('# Title')
    const result = projectIndexableDocument({
      ...location(),
      collectionId: null,
      frontMatter: MINIMAL_FRONT_MATTER,
      ast,
    })
    expect(result.collectionId).toBeNull()
  })
})
