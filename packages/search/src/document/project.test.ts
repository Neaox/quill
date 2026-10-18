import { collectionId, documentId, revisionId, workspaceId } from '@quill/domain'
import { parseMarkdown } from '@quill/markdown'
import type { CoreFrontMatter } from '@quill/markdown'
import { describe, expect, it } from 'vitest'

import { projectIndexableDocument } from './project.ts'

const DOCUMENT_ID = documentId('11111111-1111-4111-8111-111111111111')
const WORKSPACE_ID = workspaceId('22222222-2222-4222-8222-222222222222')
const COLLECTION_ID = collectionId('33333333-3333-4333-8333-333333333333')
const UPDATED_AT = new Date('2026-01-01T00:00:00.000Z')
const REVISION = revisionId('a'.repeat(40))

const MINIMAL_FRONT_MATTER: CoreFrontMatter = { id: DOCUMENT_ID }

function location() {
  return {
    documentId: DOCUMENT_ID,
    revision: REVISION,
    workspaceId: WORKSPACE_ID,
    collectionId: COLLECTION_ID,
    path: 'guides/getting-started.md',
    updatedAt: UPDATED_AT,
  }
}

describe('projectIndexableDocument: who has published', () => {
  const ast = parseMarkdown('# Runbook\n\nSteps.')
  const project = (contributors?: readonly { name: string; email: string }[]) =>
    projectIndexableDocument({
      ...location(),
      frontMatter: MINIMAL_FRONT_MATTER,
      ast,
      ...(contributors === undefined ? {} : { contributors }),
    })

  it('carries each contributor with the name and address they published under', () => {
    expect(project([{ name: 'Ada Lovelace', email: 'ada@example.com' }]).contributors).toEqual([
      { name: 'Ada Lovelace', email: 'ada@example.com' },
    ])
  })

  it('names nobody when it was not told, rather than guessing', () => {
    expect(project().contributors).toEqual([])
  })

  it('counts one address once, however often or however it was written', () => {
    expect(
      project([
        { name: 'Ada Lovelace', email: 'Ada@Example.com' },
        { name: 'A. Lovelace', email: 'ada@example.com ' },
        { name: 'Sam Taylor', email: 'sam@example.com' },
      ]).contributors,
    ).toEqual([
      { name: 'Ada Lovelace', email: 'ada@example.com' },
      { name: 'Sam Taylor', email: 'sam@example.com' },
    ])
  })

  it('writes version 3 of the document', () => {
    expect(project().version).toBe(3)
  })
})

describe('projectIndexableDocument: properties', () => {
  const ast = parseMarkdown(['# Runbook', '', 'Steps.'].join('\n'))

  it('carries the front-matter keys that are not core fields, folded', () => {
    const project = projectIndexableDocument({
      ...location(),
      frontMatter: MINIMAL_FRONT_MATTER,
      ast,
      rawFrontMatter: { id: DOCUMENT_ID, tags: ['a'], Severity: 'High', regions: ['EU'], meta: {} },
    })
    expect(project.properties).toEqual({ severity: ['high'], regions: ['eu'] })
  })

  it('has none when it was not given the front matter', () => {
    expect(
      projectIndexableDocument({ ...location(), frontMatter: MINIMAL_FRONT_MATTER, ast })
        .properties,
    ).toEqual({})
  })
})

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

  it('searches the words of the drawings the body shows, after its prose (ADR-043)', () => {
    const project = (markdown: string, drawingText: readonly string[]) =>
      projectIndexableDocument({
        ...location(),
        frontMatter: MINIMAL_FRONT_MATTER,
        ast: parseMarkdown(markdown),
        drawingText,
      }).body

    expect(project('# Title\n\nThe flow.', ['Gateway\nLedger'])).toBe('The flow.\nGateway\nLedger')
    expect(project('# Title', ['Gateway'])).toBe('Gateway')
    expect(project('# Title\n\nThe flow.', [])).toBe('The flow.')
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
    expect(result.version).toBe(3)
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
